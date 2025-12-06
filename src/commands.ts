import { Context } from "koishi";
import { Config } from "./model";

export function applyCommands(ctx: Context, config: Config) {
  // 主命令
  ctx
    .command("arcade", "机厅排队管理系统")
    .alias("机厅")
    .usage("使用 机厅帮助 查看所有命令");

  // 查询命令（无需权限）
  ctx
    .command("arcade.query <query>", "查询机厅信息")
    .alias("机厅查询")
    .action(async ({ session }: any, query: string) => {
      if (!session) return "需要会话上下文";
      const groupId = ctx.arcade.getGroupId(session);
      return await ctx.arcade.query(query, groupId);
    });

  // 添加机厅（需要权限）
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
        const result = await ctx.arcade.addArcade(
          name,
          aliases,
          groupId,
          session
        );
        return result.message;
      } catch (error: any) {
        return `❌ ${error.message}`;
      }
    });

  // 更新人数（无需权限）
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

  // 列出所有机厅（无需权限）
  ctx
    .command("arcade.list", "列出所有机厅")
    .alias("机厅列表")
    .action(async ({ session }: any) => {
      if (!session) return "需要会话上下文";
      const groupId = ctx.arcade.getGroupId(session);
      return await ctx.arcade.listAllArcades(groupId);
    });

  // 绑定其他QQ群（需要权限）
  ctx
    .command("arcade.bind <sourceGroupId>", "绑定其他QQ群的机厅数据")
    .alias("机厅绑定")
    .option("enable", "-e", { fallback: true })
    .action(async ({ session, options }: any, sourceGroupId: string) => {
      if (!session) return "需要会话上下文";
      if (!sourceGroupId)
        return "请输入源QQ群ID（格式：平台:群号，如 onebot:1234567890）";

      const groupId = ctx.arcade.getGroupId(session);

      try {
        const result = await ctx.arcade.setGroupBinding(
          groupId,
          sourceGroupId,
          options?.enable ?? true,
          session
        );
        return result.message;
      } catch (error: any) {
        return `❌ ${error.message}`;
      }
    });

  // 解绑群聊（需要权限）
  ctx
    .command("arcade.unbind", "解绑当前群聊并删除绑定机厅")
    .alias("机厅解绑")
    .action(async ({ session }: any) => {
      if (!session) return "需要会话上下文";

      try {
        const result = await ctx.arcade.unbindGroup(session);
        return result.message;
      } catch (error: any) {
        return `❌ ${error.message}`;
      }
    });

  // 重置QQ群数据（需要权限）
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

  // 生成报告（无需权限）
  ctx
    .command("arcade.report", "生成统计报告")
    .alias("机厅报告")
    .action(async ({ session }: any) => {
      if (!session) return "需要会话上下文";
      const groupId = ctx.arcade.getGroupId(session);
      return await ctx.arcade.generateReport(groupId);
    });

  // 系统状态（无需权限）
  ctx
    .command("arcade.status", "查看系统状态")
    .alias("机厅状态")
    .action(async ({ session }: any) => {
      if (!session) return "需要会话上下文";
      const groupId = ctx.arcade.getGroupId(session);

      try {
        const localArcades = await ctx.arcade.getAllArcades(groupId);
        const binding = await ctx.arcade.getGroupBinding(groupId);
        const whiteList = await ctx.arcade.getWhiteList(groupId);

        let status = "📊 机厅系统状态\n";
        status += "================\n";

        // 添加平台信息
        const platformInfo = ctx.arcade.getPlatformInfo(session);
        status += `当前平台: ${platformInfo}\n`;
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

        status += `\n🔐 白名单状态: ${
          config.enableWhiteList ? "✅ 已启用" : "❌ 已禁用"
        }\n`;
        if (config.enableWhiteList) {
          status += `白名单用户数: ${whiteList.length} 人\n`;
          status += `白名单管理: ${
            config.whiteListRequireAdmin ? "需要管理员权限" : "所有人可管理"
          }\n`;
        }

        // 显示群主配置信息
        if (config.groupOwners && config.groupOwners.length > 0) {
          status += `\n👑 配置的群主数: ${config.groupOwners.length} 人\n`;
          // 检查当前用户是否在群主列表中
          const userId = ctx.arcade.getUserId(session);
          const isInOwnerList = config.groupOwners.includes(userId);
          status += `当前用户是否在群主列表中: ${
            isInOwnerList ? "✅ 是" : "❌ 否"
          }\n`;

          // 只显示前3个，避免信息过长
          const displayOwners = config.groupOwners.slice(0, 3);
          displayOwners.forEach((owner, index) => {
            status += `  ${index + 1}. ${owner}\n`;
          });
          if (config.groupOwners.length > 3) {
            status += `  ... 等 ${config.groupOwners.length} 个群主\n`;
          }
        } else {
          status += `\n⚠️ 未配置群主列表\n`;
          if (platformInfo.includes("QQ群")) {
            status += `💡 在QQ群中使用时，需要在配置中指定群主\n`;
          }
        }

        status += `\n📅 自动清零时间: 每天 ${config.autoResetTime}\n`;
        status += `🔄 清零更新者: ${config.resetUpdater}\n`;
        status += `🏷️ 最大别名数量: ${config.maxAliasesPerArcade}个/机厅\n`;
        status += `🔐 管理员角色: ${config.adminRoles.join(", ")}\n`;

        // 权限说明
        if (config.enableWhiteList) {
          status += `\n💡 当前权限模式: 白名单已启用\n`;
          status += `   - 群主和白名单成员可以: 添加机厅、绑定/解绑群聊、重置数据\n`;
          status += `   - 所有人都可以: 查询机厅、更新人数、查看报告`;
        } else {
          status += `\n💡 当前权限模式: 白名单已禁用\n`;
          status += `   - 群主和管理员可以: 添加机厅、绑定/解绑群聊、重置数据\n`;
          status += `   - 所有人都可以: 查询机厅、更新人数、查看报告`;
        }

        // 当前用户权限状态
        try {
          const isOwner = await ctx.arcade.isGroupOwner(session);
          const isAdmin = await ctx.arcade.checkAdminPermission(session);
          const hasPermission = await ctx.arcade.checkPermission(session);

          status += `\n\n🔍 当前用户权限状态:\n`;
          status += `  是否为群主: ${isOwner ? "✅ 是" : "❌ 否"}\n`;
          status += `  是否为管理员: ${isAdmin ? "✅ 是" : "❌ 否"}\n`;
          status += `  是否有B类操作权限: ${
            hasPermission ? "✅ 有" : "❌ 无"
          }\n`;

          // 平台特定建议
          if (platformInfo.includes("QQ群") && !isOwner && !hasPermission) {
            status += `\n⚠️ QQ群权限提示:\n`;
            status += `   QQ群无法通过API自动识别群主身份\n`;
            status += `   如需获得权限，请在配置中添加群主用户ID\n`;
            status += `   你的用户ID: ${ctx.arcade.getUserId(session)}\n`;
            status += `   配置格式: groupOwners: ["qq:你的用户ID"]`;
          }
        } catch (error) {
          // 忽略权限检查错误，不影响主要功能
        }

        return status;
      } catch (error: any) {
        return `❌ 获取系统状态失败: ${error.message}`;
      }
    });

  // ==================== 白名单管理命令 ====================

  // 添加用户到白名单
  ctx
    .command("arcade.whitelist.add <targetUser>", "添加用户到白名单")
    .alias("机厅白名单添加")
    .option("name", "-n <name>", { type: "string" })
    .action(async ({ session, options }: any, targetUser: string) => {
      if (!session) return "需要会话上下文";
      if (!targetUser) return "请输入要添加的用户ID或@用户";

      try {
        // 处理用户输入（支持@用户）
        let targetUserId = targetUser;
        let targetUserName = options.name || targetUser;

        // 如果是@用户格式，提取用户ID
        if (targetUser.includes("[CQ:at")) {
          const match = targetUser.match(/\[CQ:at,qq=(\d+)\]/);
          if (match) {
            targetUserId = `${session.platform}:${match[1]}`;
            targetUserName = `用户${match[1]}`;
          }
        } else if (targetUser.match(/^\d+$/)) {
          // 纯数字QQ号
          targetUserId = `${session.platform}:${targetUser}`;
          targetUserName = options.name || `用户${targetUser}`;
        }

        const result = await ctx.arcade.addToWhiteList(
          targetUserId,
          targetUserName,
          session
        );
        return result.message;
      } catch (error: any) {
        return `❌ ${error.message}`;
      }
    });

  // 从白名单移除用户
  ctx
    .command("arcade.whitelist.remove <targetUser>", "从白名单移除用户")
    .alias("机厅白名单移除")
    .action(async ({ session }: any, targetUser: string) => {
      if (!session) return "需要会话上下文";
      if (!targetUser) return "请输入要移除的用户ID或@用户";

      try {
        // 处理用户输入
        let targetUserId = targetUser;

        if (targetUser.includes("[CQ:at")) {
          const match = targetUser.match(/\[CQ:at,qq=(\d+)\]/);
          if (match) {
            targetUserId = `${session.platform}:${match[1]}`;
          }
        } else if (targetUser.match(/^\d+$/)) {
          targetUserId = `${session.platform}:${targetUser}`;
        }

        const result = await ctx.arcade.removeFromWhiteList(
          targetUserId,
          session
        );
        return result.message;
      } catch (error: any) {
        return `❌ ${error.message}`;
      }
    });

  // 查看白名单
  ctx
    .command("arcade.whitelist.list", "查看本群白名单")
    .alias("机厅白名单列表")
    .action(async ({ session }: any) => {
      if (!session) return "需要会话上下文";

      const groupId = ctx.arcade.getGroupId(session);

      try {
        const whiteList = await ctx.arcade.getWhiteList(groupId);

        if (whiteList.length === 0) {
          return "📋 本群白名单为空";
        }

        let result = `📋 本群白名单 (共 ${whiteList.length} 人):\n\n`;

        whiteList.forEach((user, index) => {
          result += `${index + 1}. ${user.userName}\n`;
          result += `   QQ号: ${user.userId}\n`;
          result += `   添加者: ${user.addedByName}\n`;
          result += `   添加时间: ${new Date(user.createdAt).toLocaleString(
            "zh-CN"
          )}\n`;

          if (index < whiteList.length - 1) {
            result += "\n";
          }
        });

        return result;
      } catch (error: any) {
        return `❌ 获取白名单失败: ${error.message}`;
      }
    });

  // 清空白名单
  ctx
    .command("arcade.whitelist.clear", "清空本群白名单")
    .alias("机厅白名单清空")
    .action(async ({ session }: any) => {
      if (!session) return "需要会话上下文";

      try {
        const result = await ctx.arcade.clearWhiteList(session);
        return result.message;
      } catch (error: any) {
        return `❌ ${error.message}`;
      }
    });

  // 白名单开关状态
  ctx
    .command("arcade.whitelist.status", "查看白名单状态")
    .alias("机厅白名单状态")
    .action(async ({ session }: any) => {
      if (!session) return "需要会话上下文";

      const groupId = ctx.arcade.getGroupId(session);
      const whiteList = await ctx.arcade.getWhiteList(groupId);
      const isEnabled = config.enableWhiteList;
      const requireAdmin = config.whiteListRequireAdmin;

      let status = "🔐 白名单系统状态\n";
      status += "==================\n";
      status += `当前QQ群: ${groupId}\n`;
      status += `白名单功能: ${isEnabled ? "✅ 已启用" : "❌ 已禁用"}\n`;

      if (isEnabled) {
        status += `白名单管理: ${
          requireAdmin ? "需要管理员权限" : "所有人可管理"
        }\n`;
        status += `白名单用户数: ${whiteList.length} 人\n`;

        if (whiteList.length > 0) {
          status += "\n📋 白名单用户:\n";
          whiteList.slice(0, 5).forEach((user, index) => {
            status += `  ${index + 1}. ${user.userName} (${user.userId})\n`;
          });

          if (whiteList.length > 5) {
            status += `  ... 等 ${whiteList.length} 个用户\n`;
          }
        }

        status += `\n💡 权限说明：白名单启用时，只有群主和白名单用户可以执行权限操作`;
      } else {
        status += `\n💡 权限说明：白名单禁用时，只有群主和管理员可以执行权限操作`;
      }

      return status;
    });

  // 重置命令帮助
  ctx
    .command("arcade.reset-help", "查看重置操作帮助")
    .alias("机厅重置帮助")
    .action(() => {
      return `⚠️ 重置操作说明：
1. 需要权限才能执行重置操作
2. 需要输入确认文本："${config.resetConfirmationText}"
3. 重置将删除本QQ群的所有机厅数据、绑定设置和白名单
4. 重置后需要重新添加机厅
5. 使用命令：机厅重置 "${config.resetConfirmationText}"`;
    });

  // 帮助命令
  ctx
    .command("arcade.help", "查看帮助")
    .alias("机厅帮助")
    .action(() => {
      return `🎮 QQ群机厅排队管理系统 - 命令列表

📋 查询相关（无需权限）：
  机厅查询 <名称/别名>    - 查询机厅信息（支持j后缀，如"wdj"查询所有wd别名的机厅）
  机厅列表               - 列出所有机厅
  机厅报告               - 生成统计报告
  机厅状态               - 查看系统状态

🔄 操作相关：
  机厅更新 <名称> <人数> - 更新排队人数（无需权限）
  机厅添加 <名称>        - 添加机厅（需要权限，可选 -a 别名1,别名2）

🔐 白名单相关：
  机厅白名单添加 <用户>  - 添加用户到白名单（支持@用户或QQ号）
  机厅白名单移除 <用户>  - 从白名单移除用户
  机厅白名单列表         - 查看本群白名单
  机厅白名单清空         - 清空本群白名单
  机厅白名单状态         - 查看白名单状态

🔗 绑定相关（需要权限）：
  机厅绑定 <QQ群ID>      - 绑定其他QQ群的机厅数据（-e 启用/禁用）
                          QQ群ID格式：平台:群号，如 onebot:1234567890
  机厅解绑               - 解绑当前群聊并删除绑定机厅

⚠️ 管理相关（需要权限）：
  机厅重置 <确认文本>    - 重置本QQ群所有数据
  机厅重置帮助           - 查看重置操作帮助

💡 权限说明：
  - 白名单关闭时：群主和管理员可以执行所有需要权限的操作
  - 白名单开启时：群主和白名单成员可以执行所有需要权限的操作
  - 更新人数和查询功能：所有人都可以执行

💡 使用示例：
  机厅添加 迪卡丘嘉年华(佳和店) -a dkq,jhc,jh
  机厅查询 dkq
  机厅查询 jhc
  机厅更新 jh 10
  机厅白名单添加 @用户
  机厅绑定 onebot:1234567890 -e
  机厅解绑
  
🔍 别名查询说明：
  jhj = 查询所有别名包含"jh"的机厅
  dkqj = 查询所有别名包含"dkq"的机厅
  jhcj = 查询所有别名包含"jhc"的机厅`;
    });
}
