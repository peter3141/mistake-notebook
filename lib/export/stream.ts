/** 服务端 NDJSON 进度流：导出大批量时前端能显示真实进度，而不是一直转圈 */
export type Emit = (msg: Record<string, unknown>) => void

export function ndjsonResponse(run: (emit: Emit) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (msg) => controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'))
      try {
        await run(emit)
      } catch (e: any) {
        emit({ type: 'error', error: e?.message || '导出失败' })
      } finally {
        controller.close()
      }
    }
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no'
    }
  })
}
