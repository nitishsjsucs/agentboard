export default {
  async fetch(_request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
