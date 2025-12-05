import { Context } from "koishi";
import { Config, inject } from "./model";
import { ArcadeService } from "./service";
import { applyCommands } from "./commands";

export { Config };
export const name = "arcade-queue";
export { inject };

export function apply(ctx: Context, config: Config) {
  ctx.logger.info("插件 [arcade-queue] 开始加载...");

  // 创建服务
  const arcadeService = new ArcadeService(ctx, config);

  // 将服务挂载到上下文
  ctx.arcade = arcadeService;

  // 注册命令
  if (config.enableCommands) {
    applyCommands(ctx, config);
  }

  // 插件卸载时的清理
  ctx.on("dispose", () => {
    if (arcadeService) {
      arcadeService.stop();
    }
  });

  ctx.logger.info("插件 [arcade-queue] 加载完成。");
}
