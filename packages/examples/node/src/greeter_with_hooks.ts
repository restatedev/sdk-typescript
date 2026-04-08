/**
 * Example: Using hooks to log handler execution.
 *
 * Run with:
 *   pnpm --filter @restatedev/node greeter_hooks
 */

import {
  service,
  serve,
  TerminalError,
  internal,
  type Context,
  type HooksProvider,
} from "@restatedev/restate-sdk";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

function errorColor(e: unknown) {
  if (e instanceof TerminalError) return red;
  if (internal.isSuspendedError(e)) return gray;
  return yellow;
}

const logHook: HooksProvider = (ctx) => {
  const { service: svc, handler: hdl } = ctx.request.target;
  const tag = `${svc}/${hdl} [${ctx.request.id}]`;

  return {
    interceptor: {
      handler: async (next) => {
        console.group(`→ ${tag} attempt started`);
        try {
          await next();
          console.log(green(`✓ ${tag}`));
        } catch (e) {
          if (!internal.isSuspendedError(e)) {
            console.log(errorColor(e)(`✗ ${tag}: ${e as Error}`));
          }
          throw e;
        } finally {
          console.groupEnd();
        }
      },

      run: async (name, next) => {
        try {
          await next();
          console.log(green(`  ✓ run "${name}"`));
        } catch (e) {
          console.log(errorColor(e)(`  ✗ run "${name}": ${e as Error}`));
          throw e;
        }
      },
    },
  };
};

const greeter = service({
  name: "Greeter",
  handlers: {
    greet: async (ctx: Context, name: string) => {
      const greeting = await ctx.run("build-greeting", () => {
        if (Math.random() < 0.5) throw new Error("unlucky");
        return `Hello, ${name}!`;
      });
      await ctx.sleep(2000);
      return greeting;
    },
  },
  options: {
    hooks: [logHook],
    inactivityTimeout: 1000,
  },
});

serve({ services: [greeter] });
