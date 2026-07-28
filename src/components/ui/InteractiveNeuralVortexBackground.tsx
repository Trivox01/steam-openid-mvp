import { useEffect, useRef } from "react";

const vertexSource = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const fragmentSource = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec2 m;
void main(){vec2 uv=(gl_FragCoord.xy-.5*r)/min(r.x,r.y);uv+=m*.05;
float a=atan(uv.y,uv.x),d=length(uv);float wave=sin(13.*d-2.2*t+a*4.)*.5+.5;
float core=smoothstep(.8,.05,d);float arms=pow(max(0.,cos(a*3.-d*9.+t*.35)),5.);
vec3 violet=vec3(.30,.08,.72),cyan=vec3(.02,.72,.88),magenta=vec3(.78,.08,.52);
vec3 c=mix(violet,cyan,wave)*core*.65+magenta*arms*core*.28;
c+=vec3(.015,.012,.035);gl_FragColor=vec4(c,1.);}`;

export function InteractiveNeuralVortexBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const root = rootRef.current, canvas = canvasRef.current;
    if (!root || !canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
    if (!gl) return;
    let frame = 0, running = false, program: WebGLProgram | null = null;
    let vertex: WebGLShader | null = null, fragment: WebGLShader | null = null, buffer: WebGLBuffer | null = null;
    let pointerX = 0, pointerY = 0;
    const shader = (kind: number, source: string) => {
      const value = gl.createShader(kind);
      if (!value) return null;
      gl.shaderSource(value, source); gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) { gl.deleteShader(value); return null; }
      return value;
    };
    const resize = () => {
      const box = root.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(box.width * dpr));
      canvas.height = Math.max(1, Math.round(box.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const draw = (now: number) => {
      if (!program) return;
      gl.uniform2f(gl.getUniformLocation(program, "r"), canvas.width, canvas.height);
      gl.uniform1f(gl.getUniformLocation(program, "t"), reduce ? 0 : now / 1000);
      gl.uniform2f(gl.getUniformLocation(program, "m"), pointerX, pointerY);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (running && !reduce) frame = requestAnimationFrame(draw);
    };
    const start = () => { if (!running && document.visibilityState === "visible") { running = true; frame = requestAnimationFrame(draw); } };
    const stop = () => { running = false; cancelAnimationFrame(frame); };
    const initialize = () => {
      vertex = shader(gl.VERTEX_SHADER, vertexSource); fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
      if (!vertex || !fragment) return;
      program = gl.createProgram(); if (!program) return;
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      gl.useProgram(program); const location = gl.getAttribLocation(program, "p");
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      canvas.dataset.ready = "true"; resize(); reduce ? draw(0) : start();
    };
    const onPointer = (event: PointerEvent) => {
      const box = root.getBoundingClientRect();
      pointerX = (event.clientX - box.left) / box.width - .5; pointerY = .5 - (event.clientY - box.top) / box.height;
    };
    const onVisibility = () => document.visibilityState === "hidden" ? stop() : start();
    const onLost = (event: Event) => { event.preventDefault(); stop(); delete canvas.dataset.ready; };
    const onRestored = () => initialize();
    const observer = new ResizeObserver(resize);
    observer.observe(root); if (!reduce) root.addEventListener("pointermove", onPointer);
    document.addEventListener("visibilitychange", onVisibility); window.addEventListener("blur", stop); window.addEventListener("focus", start);
    canvas.addEventListener("webglcontextlost", onLost); canvas.addEventListener("webglcontextrestored", onRestored);
    initialize();
    return () => {
      stop(); observer.disconnect(); root.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("blur", stop); window.removeEventListener("focus", start);
      canvas.removeEventListener("webglcontextlost", onLost); canvas.removeEventListener("webglcontextrestored", onRestored);
      if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment);
    };
  }, []);
  return <div ref={rootRef} className="nexus-vortex" aria-hidden="true"><canvas ref={canvasRef} /></div>;
}

