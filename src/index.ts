export interface Env {
  ENVIRONMENT: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const routeName = url.searchParams.get('routeName') ?? '紅28'
    const direction = Number(url.searchParams.get('direction') ?? 0)

    return Response.json({
      ok: true,
      environment: env.ENVIRONMENT,
      routeName,
      direction,
      message: 'Worker is ready. Add route and ETA logic here.'
    })
  }
} satisfies ExportedHandler<Env>
