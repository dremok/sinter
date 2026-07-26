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
let rampData: Uint8Array | null = null
let rampElevation = Number.NaN

/**
 * Four bands, and the gaps between them are the entire point.
 *
 * The version before this had eight subtly different values, which is not cel
 * shading, it is a smooth falloff quantised so finely that nothing reads as a
 * step. Its top three bands were 0.94, 1.00 and 1.00: a 6% difference, which is
 * invisible, so every lit surface collapsed into one tone and the frame looked
 * like plain lambert. Bands only read if the jump between them is larger than
 * the variation inside them.
 *
 * The terminator stays *saturated*. A wide terminator swallows the gently
 * sloping ground, and a desaturated brown one turns every hectare it touches
 * olive, which is how an earlier attempt traded a value problem for a colour
 * problem. Its job is to be a step in value on things that stand up, not a
 * stain on the terrain.
 *
 * Values multiply the key light, so blue in the shadow band means the shadow
 * side is lit by a blue version of the key rather than by nothing. The LIGHT
 * end is near neutral on purpose: the key light is warm already, and applying
 * the same warmth twice is what turned a 6%-saturation grey rock orange.
 */
const BAND_SHADOW = [0.26, 0.33, 0.52]
const BAND_TERMINATOR = [0.6, 0.46, 0.38]
const BAND_HALF = [0.85, 0.79, 0.7]
const BAND_LIGHT = [1.0, 0.99, 0.97]

/**
 * How far a surface may turn away from the key before it leaves each band,
 * in radians of surface tilt.
 *
 * **This is the change that lets the sun move at all**, and it is worth being
 * precise about why, because the old ramp made a day cycle impossible.
 *
 * The ramp is sampled at `dot(N,L) * 0.5 + 0.5`, and its band edges used to sit
 * at fixed values of `dot`: 0, 0.25 and 0.5. But flat ground has
 * `dot(N,L) = sin(elevation)`, so as the sun rises and sets the entire ground
 * plane slides across those fixed edges. `camera.ts` already records what that
 * looks like from the one time it happened: at 36 degrees flat ground sits at
 * 0.59, so any slope over 6 degrees fell into the terminator band and the
 * clearing "broke out in blotches". That is why the sun was pinned at 44.
 *
 * Measured against the fixed edges, the usable elevation range is about 40 to
 * 62 degrees. That is not a day, it is a lunch break.
 *
 * Expressing the edges as an ANGLE below the key instead makes them travel with
 * it, so flat ground keeps the same relationship to the bands at every hour and
 * can never blotch. The two margins are chosen so that at the rig's own fixed
 * sun (43.6 degrees, from `atan(SUN_HEIGHT / SUN_REACH)` in `camera.ts`) they
 * land on sin(30) = 0.500 and sin(14.5) = 0.250, which are the old edges to
 * three decimal places. The current look is therefore unchanged, and everything
 * else this buys is free.
 */
const LIGHT_MARGIN = 13.6 * (Math.PI / 180)
const HALF_MARGIN = 29.12 * (Math.PI / 180)

/** The rig's fixed sun, until something calls `setKeyElevation`. */
const DEFAULT_ELEVATION = Math.atan2(40, 42)

/**
 * Wide enough that a band edge lands within a quarter of a degree of where it
 * should at any elevation. The old ramp was 8 texels, which quantises every
 * edge to a multiple of 0.25 in dot: fine for one hardcoded sun, useless for an
 * edge that has to move smoothly. Still nearest-filtered, so the bands are as
 * hard as they ever were; this buys precision in WHERE the step falls, not a
 * softer step.
 */
const RAMP_TEXELS = 64

/** Fill the ramp for a key light at `elevation` radians above the horizon. */
function writeRamp(elevation: number): void {
  const data = rampData!
  // Below the horizon there is no geometry left to band; hold the lowest
  // usable arrangement so a setting sun degrades instead of inverting.
  const e = Math.max(elevation, LIGHT_MARGIN * 0.5)
  const lightEdge = Math.sin(Math.max(0, e - LIGHT_MARGIN))
  const halfEdge = Math.sin(Math.max(0, e - HALF_MARGIN))

  for (let i = 0; i < RAMP_TEXELS; i++) {
    // Texel centre, mapped back to the dot(N,L) it represents.
    const dot = ((i + 0.5) / RAMP_TEXELS) * 2 - 1
    const band =
      dot >= lightEdge
        ? BAND_LIGHT
        : dot >= halfEdge
          ? BAND_HALF
          : dot >= 0
            ? BAND_TERMINATOR
            : BAND_SHADOW
    data[i * 4 + 0] = Math.round(band[0]! * 255)
    data[i * 4 + 1] = Math.round(band[1]! * 255)
    data[i * 4 + 2] = Math.round(band[2]! * 255)
    data[i * 4 + 3] = 255
  }
  rampElevation = elevation
  if (ramp) ramp.needsUpdate = true
}

/**
 * Move the bands to follow the key light.
 *
 * One texture is shared by every toon material in the game, so writing 64 texels
 * here re-lights the entire scene. Cheap enough to call every tick, and guarded
 * anyway: a change smaller than a quarter of a degree cannot move an edge by a
 * whole texel, so it cannot change a pixel.
 */
export function setKeyElevation(elevation: number): void {
  if (Math.abs(elevation - rampElevation) < 0.004) return
  toonRamp()
  writeRamp(elevation)
}

/** The elevation the ramp is currently banded for, in radians. */
export function keyElevation(): number {
  return Number.isNaN(rampElevation) ? DEFAULT_ELEVATION : rampElevation
}

/**
 * The lighting ramp, sampled at `dot(N,L) * 0.5 + 0.5`.
 *
 * The division of labour between this and the light itself is explicit, and is
 * what fixed the frame reading as harsh. The LIGHT supplies hue at the lit end.
 * The RAMP supplies value steps, and supplies hue only where the light cannot
 * reach: the terminator and the shadow, which are exactly the two bands the key
 * is leaving. That also lets the cool fill through on sunlit ground instead of
 * having its blue scaled away, which is free warm/cool contrast on the largest
 * surface in the game.
 *
 * Where the band edges fall is no longer fixed; see `LIGHT_MARGIN`.
 */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp

  const data = new Uint8Array(RAMP_TEXELS * 4)
  rampData = data
  ramp = new THREE.DataTexture(data, RAMP_TEXELS, 1, THREE.RGBAFormat)
  writeRamp(Number.isNaN(rampElevation) ? DEFAULT_ELEVATION : rampElevation)
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
  // 96 rather than 48. At 48 a metre-wide blob is 2cm per texel, which is fine,
  // but the same texture was being stretched over discs up to 4.4m across and
  // point-sampled, so the falloff turned into a staircase and the whole thing
  // read as a hard-edged dark polygon rather than as shade.
  const n = 96
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

/** Height of the ground at a world point. Passed in rather than imported, so
 *  this file never has to know that `world/region.ts` exists. */
export type HeightSampler = (x: number, z: number) => number

/** How far above the ground the sheet floats. Enough to beat depth precision,
 *  small enough that it never reads as hovering. */
const CONTACT_LIFT = 0.025

/** Scratch for the parent rotation `drape` cancels. One per module, never read
 *  across a call. */
const FLATTEN = new THREE.Quaternion()

/**
 * A darkened patch to sit a thing on the ground.
 *
 * The shadow map already grounds anything big, but it cannot help where it is
 * needed most: a character standing inside another object's cast shadow throws
 * no shadow of its own, because there is no key light left to block. A blob
 * does not care, and the player is looking at the character the whole time.
 *
 * It is a subdivided sheet that is DRAPED over the terrain, not a flat quad.
 * The flat version was a real bug and worth recording, because it failed in two
 * different-looking ways that were the same mistake:
 *
 *   - on a slope the quad cut through the ground, so half of it was buried and
 *     half floated, and the visible half was a hard-edged dark lozenge lying at
 *     the wrong angle. At tree and boulder radii that is most of the quad, and
 *     it littered every hillside in the region with dark shards.
 *   - in a dip, the character's own patch sat below the surrounding bank, the
 *     bank drew over its edges, and what was left read as a hole punched in the
 *     world with the player standing inside it.
 *
 * Following the ground fixes both at once, and it is the only fix that does:
 * shrinking it hides the first and makes the second worse.
 */
export class ContactShadow {
  readonly mesh: THREE.Mesh
  private readonly radius: number

  constructor(radius: number, opacity = 0.42) {
    this.radius = radius
    // Enough subdivisions to follow a bank, few enough to redrape every frame.
    // A creek edge is the sharpest thing in Band 0 and four spans cross it.
    const segments = Math.min(10, Math.max(3, Math.round(radius * 4)))

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2, segments, segments).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: blobTexture(),
        // Desaturated and only slightly cool. A saturated navy against
        // desaturated olive ground reads as a hole rather than as shade: the
        // hue was as wrong as the geometry.
        color: 0x2e332e,
        transparent: true,
        opacity,
        depthWrite: false,
        fog: false,
        // Belt and braces against z-fighting with the ground it lies on.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    )
    this.mesh.renderOrder = -1
    // It is a shadow. It must never be given one, and never cast one, and never
    // take an outline.
    this.mesh.userData.noShadow = true
    this.mesh.userData.noOutline = true
    // Redraped constantly and never worth a bounding-sphere rebuild.
    this.mesh.frustumCulled = false
  }

  /**
   * Lay the sheet over the ground around a world point.
   *
   * `baseY` is whatever the mesh's own origin sits at, so the vertices come out
   * relative to it and this works whether the sheet is parented to a moving
   * character or dropped into the scene at a fixed spot.
   */
  drape(cx: number, cz: number, baseY: number, sample: HeightSampler): void {
    /**
     * Square the sheet to the world before sampling anything.
     *
     * The loop below reads LOCAL vertex offsets and asks the terrain what it is
     * doing at `centre + offset`, which is only the same question if the sheet's
     * local axes are the world's. The player's blob is parented to the character
     * group, and that group sets `rotation.y` to the heading, so they were not:
     * the height field got laid onto the sheet rotated by the player's facing.
     * Draped on a bank facing along +x it was right, and facing along +z it
     * tilted ACROSS the slope instead of down it, so half the sheet sank into
     * the bank and half stood proud of it, and the whole thing counter-rotated
     * as the player turned. Measured on a 1:1 ramp under a 1.2m blob, the worst
     * vertex was 0.63m out of the ground.
     *
     * That is the same defect this class was written to fix, arriving by a
     * second route, and it reads the same way: a dark hole with the player
     * standing in it.
     *
     * Cancelling the parent's rotation is free rather than a compromise,
     * because the blob texture is radially symmetric — the sheet's yaw has never
     * been visible. `getWorldQuaternion` refreshes the ancestor matrices itself,
     * so this is correct however the caller has ordered its updates.
     */
    const parent = this.mesh.parent
    if (parent) this.mesh.quaternion.copy(parent.getWorldQuaternion(FLATTEN)).invert()

    const pos = this.mesh.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, sample(cx + pos.getX(i), cz + pos.getZ(i)) - baseY + CONTACT_LIFT)
    }
    pos.needsUpdate = true
  }

  /** World radius, so a caller can decide whether a redrape is worth it. */
  get size(): number {
    return this.radius
  }
}

// ---------------------------------------------------------------- colour grade

/**
 * The renderer, scene and camera of the live frame, for `tools/perf.mjs`.
 *
 * Same idea as `window.__sinter` in `main.ts`: a measurement needs handles the
 * game itself has no reason to expose. Populated by the first `Grade.render`
 * and never written again.
 */
interface FrameHook {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  grade: Grade
}

let frameHook: FrameHook | null = null

export function liveFrame(): FrameHook | null {
  return frameHook
}

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
  //
  // The highlight end was (1.09, 1.00, 0.87), a 1.25 spread between red and
  // blue, and it was the THIRD warm filter in a chain: the sun is lerped 34%
  // toward orange, the ramp's light band was another 0.88 of blue, and then
  // this. Each one is defensible alone and the product was not. Halving the
  // spread here is the part of that chain the grade owns.
  float l = dot( c, LUMA );
  c *= mix( vec3( 0.80, 0.92, 1.30 ), vec3( 1.045, 1.00, 0.945 ), smoothstep( 0.0, 0.68, l ) );

  // Contrast about a mid pivot, then saturation, weighted by brightness.
  //
  // Shadows lose saturation, which is the other half of making shadow read as
  // shadow: outdoors a shadow is lit by a broad grey-blue sky, so it goes flat
  // as well as cool. Desaturating everything equally is what leaves dark grass
  // looking like dark grass instead of like grass in shade.
  //
  // Highlights no longer GAIN saturation, and that is the single largest change
  // in this pass. The curve was mix(0.82, 1.22, ...), so the brighter a pixel
  // was the more chroma it got. Luminance is not role, and palette.ts allocates
  // chroma by role: "Ground, foliage, terrain: 30-40%... Items, fire, gold, the
  // player: 50-80%". The ground is the brightest large surface in the frame, so
  // a luma-keyed boost spent the chroma budget precisely on the backdrop that
  // is supposed to be restful, and left nothing separating an item from it.
  // Measured: RAMP.grass[4] is a 31%-saturation olive and open ground was
  // rendering at 53%. The grade was doing that, not the palette.
  //
  // Keeping the shadow end at 0.82 and taking the highlight end just below 1.0
  // means the grade now only ever removes chroma. Deciding where chroma goes is
  // palette.ts's job, and it is the only file that knows what a thing IS.
  //
  // Contrast stays at 1.28 deliberately. The brief is too much chroma, not too
  // much contrast, and palette.ts is explicit that value must keep doing the
  // reading as saturation comes down.
    // Then lift the black point off zero. p1 had reached 1: the darkest percent
  // of the frame was pure black, where the baseline sat at 23. Shadow with no
  // information in it is a hole, not a shadow.
  c = ( c - 0.40 ) * 1.28 + 0.455;
  c = clamp( c * 0.93 + 0.065, 0.0, 1.0 );
  float g = dot( c, LUMA );
  c = clamp( mix( vec3( g ), c, mix( 0.82, 0.96, smoothstep( 0.04, 0.58, l ) ) ), 0.0, 1.0 );

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
  /** Public only so `tools/perf.mjs` can clone it and time the scene render on
   *  its own. Nothing in `src/` should touch it. */
  readonly target: THREE.WebGLRenderTarget
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
    // Debug hook for `tools/perf.mjs`, assigned once. Measuring what a pass
    // costs needs the renderer, the scene and the camera together, and this is
    // the only place all three meet outside `main.ts`. One truthiness check per
    // frame, no allocation, and it cannot reach a pixel.
    if (!frameHook) frameHook = { renderer, scene, camera, grade: this }

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
