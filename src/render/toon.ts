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

/**
 * A hard rim on the shadow side of everything.
 *
 * This is the other half of the readability problem the outlines solve. An
 * outline says where an object ends; a rim says which way it faces and how far
 * it stands off what is behind it. Together they are why shapes in Hyper Light
 * Drifter and Don't Starve sit *in front of* the ground rather than on it.
 *
 * Three deliberate choices:
 *
 *   - it is `smoothstep`ed to a narrow edge rather than a smooth falloff,
 *     because a soft fresnel glow is a PBR idea and reads as wet plastic under
 *     flat shading. Quantised, it reads as drawn.
 *   - it is strongest where the key light is weakest, so it lands on the
 *     silhouette that would otherwise disappear into shadow, not on the lit
 *     side that already reads.
 *   - it takes its colour from the light, so it is warm under the sun and
 *     orange next to a fire, and a band retint carries through it.
 *
 * The ground gets almost none of it for free: an upward normal under this
 * camera sits nowhere near grazing, so the fresnel term stays near zero and
 * only things that stand up are rimmed.
 */
THREE.ShaderChunk.lights_toon_pars_fragment = /* glsl */ `
varying vec3 vViewPosition;

struct ToonMaterial {

	vec3 diffuseColor;

};

void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {

	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;

	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );

	float grazing = 1.0 - abs( dot( geometryNormal, geometryViewDir ) );
	float rim = smoothstep( 0.62, 0.80, grazing );
	float away = 1.0 - smoothstep( -0.15, 0.45, dot( geometryNormal, directLight.direction ) );

	// Warm, narrow and weak. At 0.26 and half this width it ran the full length
	// of every edge and picked up the cool fill as well as the key, which on a
	// tree reads as a chrome strip down wet plastic rather than as sun catching
	// matte foliage. The explicit warm tint is what stops the fill's blue from
	// turning it cyan; a rim that takes its hue straight from whichever light
	// happens to be grazing is not a rim, it is a specular.
	reflectedLight.directDiffuse += directLight.color * rim * away * 0.11 * vec3( 1.0, 0.82, 0.6 );

}

void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {

	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );

}

#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon
`

let ramp: THREE.DataTexture | null = null

/**
 * The lighting ramp, eight texels wide, sampled at `dot(N,L) * 0.5 + 0.5`.
 * Texel i therefore covers dot(N,L) from `i/4 - 1` to `(i+1)/4 - 1`.
 *
 * Three bands, and the gaps between them are the entire point.
 *
 * The previous version had eight subtly different values, which is not cel
 * shading, it is a smooth falloff quantised so finely that nothing reads as a
 * step. Its top three bands were 0.94, 1.00 and 1.00: a 6% difference, which is
 * invisible, so every lit surface collapsed into one tone and the frame looked
 * like plain lambert. Bands only read if the jump between them is larger than
 * the variation inside them.
 *
 * So: 0.30 shadow, 0.48 terminator, 0.78 half light, 0.95 light. Four steps,
 * each a long way from its neighbour, and the shadow held flat across four
 * texels so it has no internal shape at all.
 *
 * The terminator is one texel and it stays *saturated*. Both matter. A wide
 * terminator swallows the gently sloping ground, and a desaturated brown one
 * turns every hectare it touches olive, which is how the previous attempt at
 * this traded a value problem for a colour problem. Its job is to be a step in
 * value on things that stand up, not a stain on the terrain.
 *
 * The sun sits at ~44 degrees of elevation for the same reason: flat ground
 * then lands at dot(N,L) = 0.69, comfortably inside the top band, so only
 * genuinely angled faces band at all.
 */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp

  // r, g, b per band. Values multiply the key light, so blue here means the
  // shadow side is lit by a blue version of the sun rather than by nothing.
  const bands = [
    [0.26, 0.33, 0.52], // shadow: one flat cool band, no internal shape
    [0.26, 0.33, 0.52],
    [0.26, 0.33, 0.52],
    [0.27, 0.34, 0.53],
    [0.60, 0.46, 0.38], // terminator: one texel, a real step, still a colour
    [0.84, 0.76, 0.62], // the step out of it
    [1.00, 0.96, 0.88], // light
    [1.00, 0.98, 0.90],
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

/** Retina is worth having, 3x is not worth the fill rate. */
const MAX_PIXEL_RATIO = 2

/**
 * Render at the display's own resolution.
 *
 * This replaces the 720-line buffer, and it is a deliberate change of identity
 * rather than a tuning pass. Chunky pixels were doing two jobs: hiding coarse
 * geometry, and being the style. The first is no longer needed now that the
 * geometry is kitbashed and textured, and the second is now carried by the cel
 * bands, the outlines and the drawn textures, all of which get *better* with
 * resolution while a downsample only ever destroys them.
 *
 * `false` for `updateStyle` stays: the canvas is sized by CSS to fill the
 * window and three must not overwrite that.
 */
export function sizeToDisplay(renderer: THREE.WebGLRenderer, w: number, h: number): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
  renderer.setSize(w, h, false)
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

  /**
   * Exposure, in linear light, before anything else touches the frame.
   *
   * The grade had been doing its desaturation job and quietly costing a third
   * of a stop while doing it: mean luminance had slid from 103 to about 70,
   * nearly half the frame sat below L=64, and the first percentile had reached
   * 1, which is pure black. Nothing in the picture was bright.
   *
   * Worth being precise about what was actually wrong, because the two are easy
   * to confuse: reducing chroma was correct and is why the frame stopped being
   * a wall of one green. Reducing luminance was not, and was never asked for.
   * A dark frame and a low-chroma frame look similar in a thumbnail and are
   * completely different problems. This lifts the second without touching the
   * first.
   */
  c *= 1.48;

  // Highlight shoulder, in linear light, driven by the brightest channel and
  // applied to all three equally.
  //
  // Rolling off per channel is what turned firelit boulders pale pink: red
  // clipped first, so it stopped rising while green and blue kept climbing, and
  // a saturated orange desaturated into nothing on its way to white. Scaling by
  // one factor keeps the hue and the saturation and only spends the value, so a
  // very hot rock stays a very hot orange rock.
  float peak = max( c.r, max( c.g, c.b ) );
  float knee = 0.88;
  float head = 1.0 - knee;
  float rolled = min( peak, knee ) + head * ( 1.0 - exp( -max( peak - knee, 0.0 ) / head ) );
  c *= peak > 1e-4 ? rolled / peak : 1.0;

  c = toSrgb( c );

  // Split tone. Shadows toward slate, highlights toward late sun. This is what
  // carries the warm/cool contrast through cast shadows, which the ramp cannot
  // reach: a shadow map zeroes the key light, so the ramp's blue band never
  // gets to apply there.
  float l = dot( c, LUMA );
  c *= mix( vec3( 0.80, 0.92, 1.30 ), vec3( 1.09, 1.00, 0.87 ), smoothstep( 0.0, 0.68, l ) );

  // Contrast about a mid pivot, then saturation, weighted by brightness.
  //
  // Shadows lose saturation and highlights gain it, which is the other half of
  // making shadow read as shadow: outdoors a shadow is lit by a broad grey-blue
  // sky, so it goes flat as well as cool. Saturating everything equally is what
  // leaves dark grass looking like dark grass instead of like grass in shade.
    // Then lift the black point off zero. p1 had reached 1: the darkest percent
  // of the frame was pure black, where the baseline sat at 23. Shadow with no
  // information in it is a hole, not a shadow.
  c = ( c - 0.40 ) * 1.28 + 0.455;
  c = clamp( c * 0.93 + 0.065, 0.0, 1.0 );
  float g = dot( c, LUMA );
  c = clamp( mix( vec3( g ), c, mix( 0.82, 1.22, smoothstep( 0.04, 0.58, l ) ) ), 0.0, 1.0 );

  // A cooler, flatter, darker band along the top edge.
  //
  // The isometric rig never shows sky: the ground plane runs from the bottom of
  // the frame to the top, so there is no horizon and nothing tells the eye which
  // part of the frame is far away. Fog alone cannot do it, because at this zoom
  // the depth across the frame is only about twenty metres. This is the same
  // trick a painter uses when the horizon is out of shot.
  float far = smoothstep( 0.74, 1.0, vUv.y );
  vec3 distant = mix( vec3( dot( c, LUMA ) ), c, 0.75 ) * vec3( 0.88, 0.92, 1.02 );
  c = mix( c, distant, far * 0.14 );

  // Vignette, cool rather than black, so the corners read as air between the
  // camera and the far trees rather than as a lens.
  vec2 d = vUv - 0.5;
  // Ascending, then inverted: GLSL leaves smoothstep undefined when the first
  // edge is the larger one, however reliably a given driver happens to handle it.
  float v = 1.0 - smoothstep( 0.11, 0.55, dot( d, d ) );
  c = mix( c * vec3( 0.90, 0.93, 1.00 ), c, mix( 1.0, v, uVignette ) );

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
