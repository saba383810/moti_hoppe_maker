import { CONFIG } from '../config';
import type { ViewTransform } from '../interaction/coords';
import { createMesh, type Mesh } from './mesh';
import { createProgram, getUniforms } from './program';
import { FRAGMENT_SRC, VERTEX_SRC } from './shaders';
import { createImageTexture, createMaskTexture, updateMaskTexture } from './textures';

export interface FrameUniforms {
  grabCount: number;
  /** maxGrabs×4: anchor.x, anchor.y, radiusEff, strength */
  grabA: Float32Array;
  /** maxGrabs×2: pull.x, pull.y */
  grabPull: Float32Array;
  bulge: number;
  maskEnabled: boolean;
  maskView: boolean;
}

const UNIFORM_NAMES = [
  'uAspect',
  'uView',
  'uGrabCount',
  'uGrabA',
  'uGrabPull',
  'uBulge',
  'uMask',
  'uMaskEnabled',
  'uTex',
  'uMaskView',
] as const;

export class Renderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uniforms: Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null>;
  private mesh: Mesh | null = null;
  private imageTex: WebGLTexture | null = null;
  private maskTex: WebGLTexture;
  private view: ViewTransform;
  private aspect = 1;

  constructor(gl: WebGL2RenderingContext, view: ViewTransform) {
    this.gl = gl;
    this.view = view;
    this.program = createProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
    this.uniforms = getUniforms(gl, this.program, UNIFORM_NAMES);
    this.maskTex = createMaskTexture(gl);

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
    // 引っ張り部分を手前に描くための深度（liftを頂点シェーダでzに書く）
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  setImage(source: HTMLCanvasElement, aspect: number): void {
    const gl = this.gl;
    this.aspect = aspect;
    if (this.imageTex) gl.deleteTexture(this.imageTex);
    this.imageTex = createImageTexture(gl, source);
    this.mesh?.dispose();
    this.mesh = createMesh(gl, aspect);
    this.view.update(gl.drawingBufferWidth, gl.drawingBufferHeight, aspect, CONFIG.fitRatio);
  }

  updateMask(canvas: HTMLCanvasElement): void {
    updateMaskTexture(this.gl, this.maskTex, canvas);
  }

  resetMask(): void {
    const gl = this.gl;
    gl.deleteTexture(this.maskTex);
    this.maskTex = createMaskTexture(gl);
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    gl.canvas.width = width;
    gl.canvas.height = height;
    gl.viewport(0, 0, width, height);
    this.view.update(width, height, this.aspect, CONFIG.fitRatio);
  }

  draw(frame: FrameUniforms): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.mesh || !this.imageTex) return;

    gl.useProgram(this.program);
    const u = this.uniforms;
    gl.uniform1f(u.uAspect, this.aspect);
    gl.uniformMatrix3fv(u.uView, false, this.view.matrix());
    gl.uniform1i(u.uGrabCount, frame.grabCount);
    gl.uniform4fv(u.uGrabA, frame.grabA);
    gl.uniform2fv(u.uGrabPull, frame.grabPull);
    gl.uniform1f(u.uBulge, frame.bulge);
    gl.uniform1f(u.uMaskEnabled, frame.maskEnabled ? 1 : 0);
    gl.uniform1f(u.uMaskView, frame.maskView ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.uniform1i(u.uMask, 1);

    gl.bindVertexArray(this.mesh.vao);
    gl.drawElements(gl.TRIANGLES, this.mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }
}
