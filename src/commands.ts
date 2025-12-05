import { Context } from "koishi";
import { Config } from "./model";

export function applyCommands(ctx: Context, config: Config) {
  // 主命令
  ctx
    .command("arcade", "机厅排队管理系统")
    .alias("机厅")
    .usage("使用 机厅帮助 查看所有命令");

  // 查询命令
  ctx
    .command("arcade.query <query>", "查询机厅信息")
    .alias("机厅查询")
    .action(async ({ session }: any, query: string) => {
      if (!session) return "需要会话上下文";
      const groupId = ctx.arcade.getGroupId(session);
      return await ctx.arcade.query(query, groupId);
    });

  // 添加机厅
  ctx
    .command("arcade.add <name>", "添加机厅")
    .alias("机厅添加")
    .option("aliases", "-a <aliases>")
    .action(async ({ session, options }: any, name: string) => {
      if (!session) return "需要会话上下文";
      if (!name) return "请输入机厅名称";

      const groupId = ctx.arcade.getGroupId(session);
      const aliases = options?.aliases ? options.aliases.split(/[,，\s]+/) : [];

      try {
        const result = await ctx.arcade.addArcade(name, aliases, groupId);
        return result.message;
      } catch (error: any) {
        return `❌ ${error.message}`;
      }
    });

  // 更新人数
  ctx
    .command("arcade.update <query> <count:number>", "更新机厅排队人数")
    .alias("机厅更新")
    .action(async ({ session }: any, query: string, count: number) => {
      if (!session) return "需要会话上下文";
      if (!query) return "请输入机厅名称或别名";
      if (count === undefined || isNaN(count)) return "请输入有效的排队人数";

      try {
        const result = await ctx.arcade.updateQueue(query, count, session);
        return result.message;
      } catch (error: any) {
        return `❌ ${error.message}`;
      }
    });

  // 列出所有机厅
  ctx
    .command("arcade.list", "列出所有机厅")
    .alias("机厅列表")
    .action(async ({ session }: any) => {
      if (!session) return "需要会话上下文";
      const groupId = ctx.arcade.getGroupId(session);
      return await ctx.arcade.listAllArcades(groupId);
    });

  // 绑定其他QQ群
  ctx
    .command("arcade.bind <sourceGroupId>", "绑定其他QQ群的机厅数据")
    .alias("机厅绑定")
    .option("enable", "-e", { fallback: true })
    .action(async ({ session, options }: any, sourceGroupId: string) => {
      if (!session) return "需要会话上下文";
      if (!sourceGroupId)
        return "请输入源QQ群ID（格式：平台:群号，如 onebot:123456789）";

      const groupId = ctx.arcade.getGroupId(session);
      const isAdmin = await ctx.arcade.checkAdminPermission(session);

      if (!isAdmin) {
        return "❌ 只有群主或管理员可以执行此操作";
      }

      try {
        const result = await ctx.arcade.setGroupBinding(
          groupId,
          sourceGroupId,
          options?.enable ?? true
        );
        return result.message;
      } catch (error: any) {
        return `❌ ${error.message}`;
      }
    });

  // 重置QQ群数据
  ctx
    .command("arcade.reset <confirmation>", "重置本QQ群所有数据（危险操作）")
    .alias("机厅重置")
    .action(async ({ session }: any, confirmation: string) => {
      if (!session) return "需要会话上下文";
      if (!confirmation) return "请输入确认文本";

      try {
        const result = await ctx.arcade.resetGroupData(session, confirmation);
        return result.message;
      } catch (error: any) {
        return `❌ ${error.message}`;
      }
    });

  // 生成报告
  ctx
    .command("arcade.report", "生成统计报告")
    .alias("机厅报告")
    .action(async ({ session }: any) => {
      if (!session) return "需要会话上下文";
      const groupId = ctx.arcade.getGroupId(session);
      return await ctx.arcade.generateReport(groupId);
    });

  // 系统状态
  ctx
    .command("arcade.status", "查看系统状态")
    .alias("机厅状态")
    .action(async ({ session }: any) => {
      if (!session) return "需要会话上下文";
      const groupId = ctx.arcade.getGroupId(session);

      try {
        const localArcades = await ctx.arcade.getAllArcades(groupId);
        const binding = await ctx.arcade.getGroupBinding(groupId);

        let status = "📊 机厅系统状态\n";
        status += "================\n";
        status += `当前QQ群: ${groupId}\n`;
        status += `本群机厅数: ${localArcades.length}\n`;

        if (localArcades.length > 0) {
          const totalPeople = localArcades.reduce(
            (sum: number, a: any) => sum + a.current,
            0
          );
          status += `总排队人数: ${totalPeople}\n`;
        }

        if (binding?.isEnabled) {
          status += `🔗 数据绑定: 已绑定到QQ群 ${binding.sourceGroupId}\n`;
        }

        status += `\n📅 自动清零时间: 每天 ${config.autoResetTime}\n`;
        status += `🔄 清零更新者: ${config.resetUpdater}\n`;
        status += `🏷️ 最大别名数量: ${config.maxAliasesPerArcade}个/机厅\n`;
        status += `🔐 管理员角色: ${config.adminRoles.join(", ")}\n`;

        return status;
      } catch (error: any) {
        return `❌ 获取系统状态失败: ${error.message}`;
      }
    });

  // 重置命令帮助
  ctx
    .command("arcade.reset-help", "查看重置操作帮助")
    .alias("机厅重置帮助")
    .action(() => {
      return `⚠️ 重置操作说明：
1. 只有群主和管理员可以执行重置操作
2. 需要输入确认文本："${config.resetConfirmationText}"
3. 重置将删除本QQ群的所有机厅数据和设置
4. 重置后需要重新添加机厅
5. 使用命令：机厅重置 "${config.resetConfirmationText}"`;
    });

  // 帮助命令
  ctx
    .command("arcade.help", "查看帮助")
    .alias("机厅帮助")
    .action(() => {
      return `🎮 QQ群机厅排队管理系统 - 命令列表

📋 查询相关：
  机厅查询 <名称/别名>    - 查询机厅信息（支持j后缀，如"wdj"查询所有wd别名的机厅）
  机厅列表               - 列出所有机厅
  机厅报告               - 生成统计报告
  机厅状态               - 查看系统状态

🔄 操作相关：
  机厅添加 <名称>        - 添加机厅（可选 -a 别名1,别名2）
  机厅更新 <名称> <人数> - 更新排队人数

🔗 绑定相关（管理员）：
  机厅绑定 <QQ群ID>      - 绑定其他QQ群的机厅数据（-e 启用/禁用）
                          QQ群ID格式：平台:群号，如 onebot:123456789

⚠️ 管理相关（管理员）：
  机厅重置 <确认文本>    - 重置本QQ群所有数据
  机厅重置帮助           - 查看重置操作帮助

💡 使用示例：
  机厅添加 迪卡丘嘉年华(佳和店) -a dkq,jhc,jh
  机厅查询 dkq
  机厅查询 jhc
  机厅更新 jh 10
  机厅绑定 onebot:123456789 -e
  
🔍 别名查询说明：
  jhj = 查询所有别名包含"jh"的机厅
  dkqj = 查询所有别名包含"dkq"的机厅
  jhcj = 查询所有别名包含"jhc"的机厅`;
    });
}
