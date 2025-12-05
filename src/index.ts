import { Context } from "koishi";
import { Config, inject } from "./model";
import { ArcadeService } from "./service";
import { applyCommands } from "./commands";

export { Config };
export const name = "arcade-queue";
export { inject };

export function apply(ctx: Context, config: Config) {
  // 创建服务
  ctx.plugin(ArcadeService, config);

  // 注册命令
  if (config.enableCommands) {
    applyCommands(ctx, config);
  }
}
