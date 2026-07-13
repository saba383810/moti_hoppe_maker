import { CONFIG } from '../config';

export interface Mesh {
  vao: WebGLVertexArrayObject;
  indexCount: number;
  segsX: number;
  segsY: number;
  dispose(): void;
}

// 画像アスペクトに合わせたグリッドメッシュ。短辺48セグメント、セルはほぼ正方形。
export function createMesh(gl: WebGL2RenderingContext, aspect: number): Mesh {
  const short = CONFIG.meshShortSegs;
  const max = CONFIG.meshMaxSegs;
  const segsX = aspect >= 1 ? Math.min(max, Math.round(short * aspect)) : short;
  const segsY = aspect >= 1 ? short : Math.min(max, Math.round(short / aspect));

  const cols = segsX + 1;
  const rows = segsY + 1;
  const positions = new Float32Array(cols * rows * 2);
  let p = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      positions[p++] = x / segsX;
      positions[p++] = y / segsY;
    }
  }

  const indices = new Uint16Array(segsX * segsY * 6);
  let q = 0;
  for (let y = 0; y < segsY; y++) {
    for (let x = 0; x < segsX; x++) {
      const i0 = y * cols + x;
      const i1 = i0 + 1;
      const i2 = i0 + cols;
      const i3 = i2 + 1;
      indices[q++] = i0;
      indices[q++] = i2;
      indices[q++] = i1;
      indices[q++] = i1;
      indices[q++] = i2;
      indices[q++] = i3;
    }
  }

  const vao = gl.createVertexArray();
  if (!vao) throw new Error('createVertexArray failed');
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  return {
    vao,
    indexCount: indices.length,
    segsX,
    segsY,
    dispose() {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ibo);
    },
  };
}
