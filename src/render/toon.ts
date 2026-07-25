/**
 * Cel shading, the pixel buffer, and the colour grade. Between them these are
 * most of the reason the game reads as a 16-bit console game rather than as
 * untextured low-poly.
 *
 * Three ideas, all cheap:
 *
 * 1. Every surface uses MeshToonMaterial against a gradient ramp, so lighting
 *    lands in flat bands instead of a smooth falloff. The ramp here is RGB
 *    rather than greyscale, which is the whole reason the frame has a time of
 *    day: light lands warm, the terminator lands orange, and the shadow side
 *    lands blue. Grey bands can only make things darker, and "darker" is not
 *    what shadow looks like outdoors.
 *
 * 2. The whole scene renders into a buffer 720 lines tall and is then upscaled
 *    to the window with nearest-neighbour filtering, done in CSS rather than
 *    with a post-processing pass. Chunky pixels are extremely forgiving of
 *    coarse geometry.
 *
 * 3. One fullscreen pass grades the result: highlight shoulder, split tone,
 *    contrast, saturation, vignette. No post-processing dependency, one extra
 *    draw call.
 */

import * as THREE from 'three'

/**
 * Vertical resolution of the internal buffer.
 *
 * Raised twice on playtest feedback: 240 was unreadable, 400 was still too
 * soft. At 720 the upscale to a 1080p display is 1.5x, which keeps edges hard
 * and the hand-drawn textures legible without the frame reading as pixellated.
 * The look now comes from the textures and the cel ramp rather than from
 * throwing resolution away.
 */
export const PIXEL_HEIGHT = 720

/**
 * Let the toon gradient ramp carry colour.
 *
 * Stock three reads only the red channel of `gradientMap`, so a toon ramp can
 * only ever say "how bright", never "what colour". That is the single reason
 * cel shading here looked like flat plastic: every band was the surface colour
 * scaled down, and a shadow that is just a darker green does not read as a
 * shadow, it reads as a stain.
 *
 * Taking `.rgb` instead makes the ramp a per-band tint on the key light, which
 * is how hand-painted work does it: warm where the sun lands, a hot terminator
 * at the turn, cool blue in the dark. The rest of the chunk is three's own; only
 * the swizzle changed. Overriding the chunk rather than every material means
 * `render/icons.ts` and its separate renderer get the same look for free.
 */
THREE.ShaderChunk.gradientmap_pars_fragment = /* glsl */ `

#ifdef USE_GRADIENTMAP

	uniform sampler2D gradientMap;

#endif

vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {

	// dotNL will be from -1.0 to 1.0
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );

	#ifdef USE_GRADIENTMAP

		return texture2D( gradientMap, coord ).rgb;

	#else

		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );

	#endif

}
`

let ramp: THREE.DataTexture | null = null

/**
 * The lighting ramp, eight texels wide, sampled at `dot(N,L) * 0.5 + 0.5`.
 * Texel i therefore covers dot(N,L) from `i/4 - 1` to `(i+1)/4 - 1`, which puts
 * the terminator exactly on the texel 3/4 boundary.
 *
 * It is eight texels to place three *visual* bands precisely, not to have eight
 * of them. Texels 0-3 are one cool shadow with a barely perceptible inner step,
 * texel 4 is a single narrow warm terminator, and 5-7 are one lit band that
 * lifts very slightly toward the sun. A narrow terminator is what separates
 * shaped cel work from a two-tone stencil.
 */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp

  // r, g, b per band. Values multiply the key light, so blue here means the
  // shadow side is lit by a blue version of the sun rather than by nothing.
  const bands = [
    [0.30, 0.38, 0.58], // facing fully away: deep, cool
    [0.30, 0.38, 0.58],
    [0.32, 0.40, 0.60],
    [0.36, 0.45, 0.63], // the shadow lifts a little as it approaches the turn
    [0.80, 0.55, 0.38], // terminator: one narrow band of hot orange
    [0.94, 0.82, 0.62], // and one golden step out of it, or the turn is a jump
    [1.00, 0.96, 0.87],
    [1.00, 0.99, 0.93], // square to the sun
  ]

  const data = new Uint8Array(bands.length * 4)
  for (let i = 0; i < bands.length; i++) {
    const [r, g, b] = bands[i]!
    data[i * 4 + 0] = Math.round(r! * 255)
    data[i * 4 + 1] = Math.round(g! * 255)
    data[i * 4 + 2] = Math.round(b! * 255)
    data[i * 4 + 3] = 255
  }

  ramp = new THREE.DataTexture(data, bands.length, 1, THREE.RGBAFormat)
  ramp.minFilter = THREE.NearestFilter
  ramp.magFilter = THREE.NearestFilter
  ramp.generateMipmaps = false
  ramp.needsUpdate = true
  return ramp
}

const cache = new Map<number, THREE.MeshToonMaterial>()

/** Shared cel-shaded material for a colour. */
export function toon(color: number): THREE.MeshToonMaterial {
  const hit = cache.get(color)
  if (hit) return hit
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() })
  cache.set(color, m)
  return m
}

/** A one-off cel-shaded material, for anything that needs its own uniforms. */
export function toonUnique(params: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params })
}

/**
 * Size the drawing buffer to ~PIXEL_HEIGHT lines while leaving the CSS size
 * alone, so the browser scales it up. `false` for `updateStyle` is the whole
 * trick; without it three.js overwrites the CSS size and the pixellation
 * disappears.
 */
export function sizeToPixelBuffer(renderer: THREE.WebGLRenderer, w: number, h: number): void {
  const aspect = w / h
  const bufferH = PIXEL_HEIGHT
  const bufferW = Math.round(bufferH * aspect)
  renderer.setPixelRatio(1)
  renderer.setSize(bufferW, bufferH, false)
}

// ------------------------------------------------------------- contact shadow

let blob: THREE.DataTexture | null = null

/** Radial alpha, squared so the middle stays dense and the rim goes to nothing.
 *  Small and nearest-filtered, like every other texture here. (D14) */
function blobTexture(): THREE.DataTexture {
  if (blob) return blob
  const n = 48
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5
      const dy = (y + 0.5) / n - 0.5
      const edge = Math.max(0, 1 - Math.hypot(dx, dy) * 2)
      data[(y * n + x) * 4 + 3] = Math.round(edge * edge * 255)
    }
  }
  blob = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  blob.minFilter = THREE.NearestFilter
  blob.magFilter = THREE.NearestFilter
  blob.generateMipmaps = false
  blob.needsUpdate = true
  return blob
}

/**
 * A darkened patch to sit a thing on the ground.
 *
 * The shadow map already grounds anything big, but it cannot help where it is
 * needed most: a character standing inside another object's cast shadow throws
 * no shadow of its own, because there is no key light left to block. A blob
 * does not care, and the player is looking at the character the whole time.
 *
 * Cool rather than black, so it belongs to the same shadow family as everything
 * else in the frame.
 */
export function groundBlob(radius: number, opacity = 0.45): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: blobTexture(),
      color: 0x121e30,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
    }),
  )
  mesh.position.y = 0.03
  mesh.renderOrder = -1
  // It is a shadow. It must never be given one, and never cast one.
  mesh.userData.noShadow = true
  return mesh
}

// ---------------------------------------------------------------- colour grade

const GRADE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`

const GRADE_FRAG = /* glsl */ `
uniform sampler2D tFrame;
uniform float uVignette;
varying vec2 vUv;

const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

vec3 toSrgb( vec3 c ) {
  c = max( c, vec3( 0.0 ) );
  return mix( c * 12.92, 1.055 * pow( c, vec3( 0.4166667 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}

void main() {
  vec3 c = texture2D( tFrame, vUv ).rgb;

  // Highlight shoulder, in linear light. A flame core or a sunlit thatch roof
  // rolls off into warm white instead of clipping every channel to 1.0 at once,
  // which is what turns a fire into a white hole.
  vec3 knee = vec3( 0.76 );
  vec3 head = vec3( 1.0 ) - knee;
  vec3 over = max( c - knee, vec3( 0.0 ) );
  c = min( c, knee ) + head * ( vec3( 1.0 ) - exp( -over / head ) );

  c = toSrgb( c );

  // Split tone. Shadows toward slate, highlights toward late sun. This is what
  // carries the warm/cool contrast through cast shadows, which the ramp cannot
  // reach: a shadow map zeroes the key light, so the ramp's blue band never
  // gets to apply there.
  float l = dot( c, LUMA );
  c *= mix( vec3( 0.76, 0.90, 1.29 ), vec3( 1.08, 1.00, 0.89 ), smoothstep( 0.0, 0.60, l ) );

  // Contrast about a mid pivot, then saturation, weighted by brightness.
  //
  // Shadows lose saturation and highlights gain it, which is the other half of
  // making shadow read as shadow: outdoors a shadow is lit by a broad grey-blue
  // sky, so it goes flat as well as cool. Saturating everything equally is what
  // leaves dark grass looking like dark grass instead of like grass in shade.
  c = clamp( ( c - 0.46 ) * 1.13 + 0.46, 0.0, 1.0 );
  float g = dot( c, LUMA );
  c = clamp( mix( vec3( g ), c, mix( 0.80, 1.14, smoothstep( 0.04, 0.58, l ) ) ), 0.0, 1.0 );

  // Vignette, cool rather than black, so the corners read as air between the
  // camera and the far trees rather than as a lens.
  vec2 d = vUv - 0.5;
  float v = smoothstep( 0.52, 0.13, dot( d, d ) );
  c = mix( c * vec3( 0.83, 0.88, 0.99 ), c, mix( 1.0, v, uVignette ) );

  gl_FragColor = vec4( c, 1.0 );
}
`

/**
 * A one-pass colour grade.
 *
 * The scene renders into a half-float target and a single fullscreen triangle-
 * ish quad grades it onto the canvas. Half float rather than bytes because the
 * shoulder above needs values over 1.0 to roll off; with a byte target they are
 * already clipped by the time the grade sees them.
 *
 * Deliberately not a post-processing library. Two draw calls and about thirty
 * lines of GLSL buys the entire difference between "a render" and "a frame".
 */
export class Grade {
  private readonly target: THREE.WebGLRenderTarget
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private readonly size = new THREE.Vector2()

  constructor(vignette = 1) {
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    })
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace
    this.target.texture.generateMipmaps = false

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tFrame: { value: this.target.texture },
        uVignette: { value: vignette },
      },
      vertexShader: GRADE_VERT,
      fragmentShader: GRADE_FRAG,
      depthTest: false,
      depthWrite: false,
    })

    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material))
  }

  /**
   * Render `scene` through the grade. Resizes itself from the renderer's own
   * drawing buffer, so nothing has to remember to tell it about a window resize.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    renderer.getDrawingBufferSize(this.size)
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) {
      this.target.setSize(this.size.x, this.size.y)
    }

    renderer.setRenderTarget(this.target)
    renderer.render(scene, camera)

    renderer.setRenderTarget(null)
    renderer.render(this.scene, this.camera)
  }
}
