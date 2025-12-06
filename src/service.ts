import { Context, Service } from "koishi";
import {
  Config,
  Arcade,
  ArcadeHistory,
  GroupBinding,
  WhiteListUser,
} from "./model";

declare module "koishi" {
  interface Context {
    arcade: ArcadeService;
  }
}

export class ArcadeService extends Service {
  private timers: Map<string, NodeJS.Timeout> = new Map();

  static [Service.provide] = "arcade";
  static [Service.immediate] = true;

  constructor(public ctx: Context, public config: Config) {
    super(ctx, "arcade");

    // 初始化数据库表
    this.initDatabase();

    // 设置定时任务
    this.setupAllAutoResets();
  }

  private async initDatabase() {
    // 定义 arcade 表
    this.ctx.model.extend(
      "arcade",
      {
        id: "unsigned",
        name: "string",
        aliases: "json",
        current: "integer",
        average: "double",
        totalUpdates: "integer",
        totalPeople: "integer",
        lastUpdated: "timestamp",
        lastUpdater: "string",
        updaterId: "string",
        groupId: "string",
        sourceGroupId: "string",
        createdAt: "timestamp",
        updatedAt: "timestamp",
        isBound: "boolean",
      },
      {
        primary: "id",
        unique: ["groupId", "name"],
        autoInc: true,
      }
    );

    // 定义 arcade_history 表
    this.ctx.model.extend(
      "arcade_history",
      {
        id: "unsigned",
        arcadeId: "unsigned",
        count: "integer",
        updater: "string",
        updaterId: "string",
        groupId: "string",
        updatedAt: "timestamp",
      },
      {
        primary: "id",
        foreign: {
          arcadeId: ["arcade", "id"],
        },
      }
    );

    // 定义 group_binding 表
    this.ctx.model.extend(
      "group_binding",
      {
        id: "unsigned",
        sourceGroupId: "string",
        targetGroupId: "string",
        isEnabled: "boolean",
        createdAt: "timestamp",
        updatedAt: "timestamp",
      },
      {
        primary: "id",
        unique: ["targetGroupId"],
      }
    );

    // 定义 white_list 表
    this.ctx.model.extend(
      "white_list",
      {
        id: "unsigned",
        userId: "string",
        userName: "string",
        groupId: "string",
        addedBy: "string",
        addedByName: "string",
        createdAt: "timestamp",
        updatedAt: "timestamp",
      },
      {
        primary: "id",
        unique: ["groupId", "userId"],
        autoInc: true,
      }
    );
  }

  // ==================== 通用方法 ====================

  // 获取当前QQ群ID
  public getGroupId(session: any): string {
    if (!session) return "unknown:unknown";
    return `${session.platform}:${
      session.guildId || session.channelId || "private"
    }`;
  }

  // 获取用户ID
  public getUserId(session: any): string {
    if (!session) return "system";
    return `${session.platform}:${session.userId}`;
  }

  // 格式化时间
  public formatDateTime(date: Date): string {
    return date.toISOString().replace("T", " ").substring(0, 19);
  }

  // 获取平台信息
  public getPlatformInfo(session: any): string {
    if (!session) return "未知";

    const groupId = this.getGroupId(session);
    let platformType = "未知";

    if (session.guildId) {
      if (
        session.guildId.includes("guild_") ||
        session.guildId.includes("group_")
      ) {
        platformType = "QQ频道";
      } else if (
        session.platform === "qq" &&
        /^[A-F0-9]{32}$/.test(session.guildId)
      ) {
        platformType = "QQ群（开放平台）";
      } else {
        platformType = "QQ群";
      }
    }

    return platformType;
  }

  // 获取身份组映射说明
  public getRoleMapping(): string {
    return `🎮 身份组系统说明：

📱 QQ频道（支持API自动识别）：
  1: 全体成员
  2: 管理员
  4: 群主/创建者
  5: 子频道管理员

👥 QQ群（需要配置指定群主）：
  • API无法自动识别群主身份
  • 需要在配置文件中指定群主
  • 格式: "qq:用户ID"
  • 示例: "qq:159411E004A1886B1E2083DCE2250CAA"

💡 如何获取用户ID？
  使用命令：权限检查
  或在配置中查看用户ID`;
  }

  // ==================== 平台检测方法 ====================

  // 检测是否为QQ频道
  private isQQGuild(groupId: string): boolean {
    return (
      groupId.includes("guild_") ||
      groupId.includes("group_") ||
      (groupId.includes("qq:") &&
        (groupId.includes("guild_") || groupId.includes("group_")))
    );
  }

  // 检测是否为QQ群
  private isQQGroup(groupId: string): boolean {
    return !this.isQQGuild(groupId);
  }

  // ==================== 权限检查方法 ====================

  // 统一的群主检查方法，根据平台类型使用不同的策略
  async isGroupOwner(session: any): Promise<boolean> {
    const userId = this.getUserId(session);
    const groupId = this.getGroupId(session);

    // 1. 首先检查是否在配置的群主列表中（最高优先级）
    if (this.config.groupOwners && this.config.groupOwners.includes(userId)) {
      this.ctx.logger.info(`用户 ${userId} 在配置的群主列表中`);
      return true;
    }

    // 2. 如果没有session必要参数，直接返回false
    if (!session?.bot || !session.guildId || !session.userId) {
      return false;
    }

    // 3. 根据平台类型使用不同的检查策略
    if (this.isQQGuild(session.guildId)) {
      // QQ频道：使用API检查roles数组
      return await this.checkQQGuildOwner(session);
    } else {
      // QQ群：使用备用检查策略
      return await this.checkQQGroupOwner(session);
    }
  }

  // QQ频道的群主检查（使用API的roles数组）
  private async checkQQGuildOwner(session: any): Promise<boolean> {
    try {
      // 获取成员信息
      const member = await session.bot.getGuildMember(
        session.guildId,
        session.userId
      );

      if (!member) {
        this.ctx.logger.warn(
          `获取QQ频道成员信息为空: guildId=${session.guildId}, userId=${session.userId}`
        );
        return false;
      }

      this.ctx.logger.debug(`QQ频道成员信息: ${JSON.stringify(member)}`);

      // 根据官方API文档检查 roles 数组
      if (member.roles && Array.isArray(member.roles)) {
        // roles 数组中的元素是字符串，如 ["1", "2", "4"] 等
        const isOwner = member.roles.includes("4");
        this.ctx.logger.info(
          `QQ频道检查 roles 数组: ${JSON.stringify(
            member.roles
          )}, 包含群主(4): ${isOwner}`
        );
        return isOwner;
      }

      // 兼容性检查：检查 role 字段
      if (member.role === "4" || member.role === 4) {
        this.ctx.logger.info(
          `QQ频道用户 ${session.userId} 是群主 (role字段为"4")`
        );
        return true;
      }

      this.ctx.logger.warn(
        `QQ频道用户 ${session.userId} 不是群主，roles: ${JSON.stringify(
          member.roles
        )}, role: ${member.role}`
      );
      return false;
    } catch (error: any) {
      this.ctx.logger.error(`QQ频道检查群主权限失败: ${error.message}`);
      return false;
    }
  }

  // QQ群的群主检查（使用备用策略）
  private async checkQQGroupOwner(session: any): Promise<boolean> {
    const userId = this.getUserId(session);

    // QQ群的备用检查策略
    this.ctx.logger.info(`QQ群使用备用策略检查群主身份: ${userId}`);

    // 策略1: 尝试通过Bot API获取成员信息（可能有限制）
    try {
      const member = await session.bot.getGuildMember(
        session.guildId,
        session.userId
      );

      if (member) {
        this.ctx.logger.debug(`QQ群成员信息: ${JSON.stringify(member)}`);

        // 检查可能的群主标识
        if (member.role === "owner" || member.role === "群主") {
          this.ctx.logger.info(
            `QQ群用户 ${session.userId} 是群主 (role=owner)`
          );
          return true;
        }

        if (member.authority === 3) {
          this.ctx.logger.info(
            `QQ群用户 ${session.userId} 是群主 (authority=3)`
          );
          return true;
        }

        // 检查其他可能的字段
        const ownerFields = [
          "is_owner",
          "owner",
          "isOwner",
          "is_creator",
          "creator",
        ];
        for (const field of ownerFields) {
          if (member[field] === true || member[field] === 1) {
            this.ctx.logger.info(
              `QQ群用户 ${session.userId} 是群主 (${field}=true)`
            );
            return true;
          }
        }
      }
    } catch (error: any) {
      this.ctx.logger.debug(
        `QQ群获取成员信息失败，继续使用其他策略: ${error.message}`
      );
    }

    // 策略2: 检查是否有其他API可用
    try {
      // 尝试获取群信息，检查owner_id
      if (session.bot.getGuild) {
        const guild = await session.bot.getGuild(session.guildId);
        if (guild && guild.owner_id) {
          const isOwner = guild.owner_id === session.userId;
          this.ctx.logger.info(
            `QQ群通过owner_id检查: ${guild.owner_id} === ${session.userId} = ${isOwner}`
          );
          return isOwner;
        }
      }
    } catch (error: any) {
      this.ctx.logger.debug(`QQ群获取群信息失败: ${error.message}`);
    }

    // 策略3: 基于配置的备用检查（已在isGroupOwner方法中检查）

    // 策略4: 基于QQ号的检查（最后的手段）
    const qqNumber = this.extractQQNumber(session.userId);
    if (qqNumber) {
      // 这里可以添加基于QQ号的检查逻辑
      const ownerQQNumbers: string[] = [
        // 可以在这里添加已知的群主QQ号
      ];

      if (ownerQQNumbers.includes(qqNumber)) {
        this.ctx.logger.info(`QQ群基于QQ号识别为群主: ${qqNumber}`);
        return true;
      }
    }

    this.ctx.logger.warn(
      `QQ群用户 ${userId} 无法确定为群主，请使用配置方式指定`
    );
    return false;
  }

  // 检查用户是否为管理员（包括群主）
  async checkAdminPermission(session: any): Promise<boolean> {
    // 1. 如果是群主，直接返回 true
    if (await this.isGroupOwner(session)) {
      return true;
    }

    // 2. 尝试通过API获取成员信息
    if (!session?.bot || !session.guildId || !session.userId) {
      return false;
    }

    try {
      const member = await session.bot.getGuildMember(
        session.guildId,
        session.userId
      );

      if (!member) return false;

      // 根据平台类型使用不同的检查策略
      if (this.isQQGuild(session.guildId)) {
        // QQ频道：检查roles数组
        if (member.roles && Array.isArray(member.roles)) {
          const isAdmin =
            member.roles.includes("2") || member.roles.includes("4");
          this.ctx.logger.info(
            `QQ频道检查管理员 roles: ${JSON.stringify(
              member.roles
            )}, 是管理员: ${isAdmin}`
          );
          return isAdmin;
        }
      } else {
        // QQ群：检查role字段或其他标识
        if (
          member.role === "2" ||
          member.role === 2 ||
          member.role === "admin" ||
          member.role === "管理员"
        ) {
          return true;
        }

        if (member.authority === 2) {
          return true;
        }
      }

      // 检查配置中的管理员角色
      if (
        member.role &&
        this.config.adminRoles.includes(member.role.toString())
      ) {
        return true;
      }

      return false;
    } catch (error: any) {
      this.ctx.logger.warn("检查管理员权限失败:", error);
      return false;
    }
  }

  // 检查用户是否在白名单中
  async isUserInWhiteList(userId: string, groupId: string): Promise<boolean> {
    const users = await this.ctx.database.get("white_list", {
      userId,
      groupId,
    });
    return users.length > 0;
  }

  // B类操作权限检查（添加、删除、重置、绑定、解绑）
  async checkPermission(session: any): Promise<boolean> {
    const userId = this.getUserId(session);
    const groupId = this.getGroupId(session);

    // 1. 群主永远有权限
    if (await this.isGroupOwner(session)) {
      this.ctx.logger.info(`用户 ${userId} 是群主，权限已通过`);
      return true;
    }

    // 2. 检查白名单开关状态
    if (this.config.enableWhiteList) {
      // 白名单开启：检查是否在白名单中
      return await this.isUserInWhiteList(userId, groupId);
    } else {
      // 白名单关闭：检查是否为管理员
      return await this.checkAdminPermission(session);
    }
  }

  // ==================== 辅助方法 ====================

  // 从用户ID中提取QQ号
  private extractQQNumber(userId: string): string | null {
    // 格式可能是 "qq:123456789" 或 "123456789" 或其他
    if (userId.includes(":")) {
      const parts = userId.split(":");
      if (parts.length >= 2) {
        const idPart = parts[1];
        // 检查是否是纯数字（QQ号）
        if (/^\d+$/.test(idPart)) {
          return idPart;
        }
      }
    } else if (/^\d+$/.test(userId)) {
      return userId;
    }
    return null;
  }

  // 获取完整的成员信息（调试用）
  async getMemberDetail(session: any): Promise<any> {
    if (!session?.bot || !session.guildId || !session.userId) {
      return null;
    }

    try {
      const member = await session.bot.getGuildMember(
        session.guildId,
        session.userId
      );
      return member;
    } catch (error) {
      this.ctx.logger.error(`获取成员信息失败: ${error}`);
      return null;
    }
  }

  // ==================== 白名单管理方法 ====================

  // 添加用户到白名单
  async addToWhiteList(
    targetUserId: string,
    targetUserName: string,
    session: any
  ) {
    const groupId = this.getGroupId(session);
    const operatorId = this.getUserId(session);
    const operatorName = session?.username || session?.userId || "未知用户";

    // 检查操作者权限
    if (
      this.config.whiteListRequireAdmin &&
      !(await this.checkAdminPermission(session))
    ) {
      throw new Error("❌ 只有群主或管理员可以管理白名单");
    }

    // 检查目标用户是否已在白名单中
    const existing = await this.ctx.database.get("white_list", {
      userId: targetUserId,
      groupId,
    });

    if (existing.length > 0) {
      throw new Error(`用户 ${targetUserName} (${targetUserId}) 已在白名单中`);
    }

    const now = new Date();
    await this.ctx.database.create("white_list", {
      userId: targetUserId,
      userName: targetUserName,
      groupId,
      addedBy: operatorId,
      addedByName: operatorName,
      createdAt: now,
      updatedAt: now,
    });

    this.ctx.logger.info(
      `QQ群 ${groupId} 添加白名单用户: ${targetUserName} (${targetUserId})`
    );

    return {
      success: true,
      message: `✅ 已添加用户 ${targetUserName} 到白名单`,
      data: {
        userId: targetUserId,
        userName: targetUserName,
        groupId,
        addedBy: operatorName,
      },
    };
  }

  // 从白名单移除用户
  async removeFromWhiteList(targetUserId: string, session: any) {
    const groupId = this.getGroupId(session);

    // 检查操作者权限
    if (
      this.config.whiteListRequireAdmin &&
      !(await this.checkAdminPermission(session))
    ) {
      throw new Error("❌ 只有群主或管理员可以管理白名单");
    }

    // 检查目标用户是否在白名单中
    const existing = await this.ctx.database.get("white_list", {
      userId: targetUserId,
      groupId,
    });

    if (existing.length === 0) {
      throw new Error(`用户 ${targetUserId} 不在白名单中`);
    }

    await this.ctx.database.remove("white_list", {
      userId: targetUserId,
      groupId,
    });

    this.ctx.logger.info(`QQ群 ${groupId} 移除白名单用户: ${targetUserId}`);

    return {
      success: true,
      message: `✅ 已从白名单移除用户 ${existing[0].userName || targetUserId}`,
      data: {
        userId: targetUserId,
        groupId,
      },
    };
  }

  // 获取本群白名单列表
  async getWhiteList(groupId: string): Promise<WhiteListUser[]> {
    return await this.ctx.database.get("white_list", { groupId });
  }

  // 清空本群白名单
  async clearWhiteList(session: any) {
    const groupId = this.getGroupId(session);

    // 检查操作者权限
    if (
      this.config.whiteListRequireAdmin &&
      !(await this.checkAdminPermission(session))
    ) {
      throw new Error("❌ 只有群主或管理员可以管理白名单");
    }

    const count = await this.ctx.database
      .select("white_list")
      .where({ groupId })
      .execute()
      .then((rows) => rows.length);

    await this.ctx.database.remove("white_list", { groupId });

    this.ctx.logger.info(`QQ群 ${groupId} 清空白名单，共移除 ${count} 个用户`);

    return {
      success: true,
      message: `✅ 已清空白名单，共移除 ${count} 个用户`,
      data: { groupId, count },
    };
  }

  // ==================== 机厅核心方法 ====================

  // 搜索机厅（核心方法）
  private async findArcade(
    query: string,
    groupId: string
  ): Promise<Arcade | null> {
    // 1. 精确匹配名称（本群）
    const localExact = await this.ctx.database.get("arcade", {
      name: query,
      groupId,
    });
    if (localExact.length > 0) return localExact[0];

    // 2. 匹配别名（本群）
    const localArcades = await this.ctx.database.get("arcade", { groupId });
    for (const arcade of localArcades) {
      if (arcade.aliases?.includes(query)) {
        return arcade;
      }
    }

    // 3. 检查绑定数据
    const binding = await this.getGroupBinding(groupId);
    if (binding?.isEnabled) {
      const sourceArcades = await this.ctx.database.get("arcade", {
        groupId: binding.sourceGroupId,
      });

      // 精确匹配源群聊名称
      for (const arcade of sourceArcades) {
        if (arcade.name === query) {
          return {
            ...arcade,
            isBound: true,
            sourceGroupId: binding.sourceGroupId,
          };
        }

        // 匹配源群聊别名
        if (arcade.aliases?.includes(query)) {
          return {
            ...arcade,
            isBound: true,
            sourceGroupId: binding.sourceGroupId,
          };
        }
      }
    }

    // 4. 模糊匹配名称
    for (const arcade of localArcades) {
      if (arcade.name.includes(query)) {
        return arcade;
      }
    }

    return null;
  }

  // 通过别名搜索机厅
  private async findArcadesByAlias(
    keyword: string,
    groupId: string
  ): Promise<Arcade[]> {
    const localArcades = await this.ctx.database.get("arcade", { groupId });
    const results: Arcade[] = [];

    // 搜索本群聊的机厅
    for (const arcade of localArcades) {
      if (arcade.aliases?.some((alias) => alias.includes(keyword))) {
        results.push(arcade);
      }
    }

    // 搜索绑定群聊的机厅
    const binding = await this.getGroupBinding(groupId);
    if (binding?.isEnabled) {
      const sourceArcades = await this.ctx.database.get("arcade", {
        groupId: binding.sourceGroupId,
      });

      for (const arcade of sourceArcades) {
        if (arcade.aliases?.some((alias) => alias.includes(keyword))) {
          results.push({
            ...arcade,
            isBound: true,
            sourceGroupId: binding.sourceGroupId,
          });
        }
      }
    }

    return results;
  }

  // 查询机厅（公开接口）
  async query(query: string, groupId: string): Promise<string> {
    if (!query) {
      return await this.listAllArcades(groupId);
    }

    query = query.trim();
    let arcades: Arcade[] = [];
    let searchType = "";

    // 处理j后缀查询（如 wdj 查询所有别名包含 wd 的机厅）
    if (query.endsWith("j")) {
      const keyword = query.slice(0, -1);
      arcades = await this.findArcadesByAlias(keyword, groupId);
      searchType = "alias_j";
    } else {
      // 普通查询
      const arcade = await this.findArcade(query, groupId);
      if (arcade) {
        arcades = [arcade];
        searchType = "exact";
      } else {
        // 尝试模糊查询
        const allArcades = await this.getAllArcadesWithBinding(groupId);
        arcades = allArcades.filter(
          (a) =>
            a.name.includes(query) ||
            a.aliases?.some((alias) => alias.includes(query))
        );
        searchType = "fuzzy";
      }
    }

    if (arcades.length === 0) {
      return `未找到匹配 "${query}" 的机厅`;
    }

    // 格式化输出
    let result = "";
    if (searchType === "alias_j") {
      const keyword = query.slice(0, -1);
      result += `🔍 查询关键词: "${keyword}" (${query})\n`;
    }

    result += `📋 找到 ${arcades.length} 个机厅:\n\n`;

    arcades.forEach((arcade, index) => {
      result += `${index + 1}. ${arcade.name}`;
      if (arcade.isBound) {
        result += ` [绑定数据]`;
      }
      result += `\n`;

      if (arcade.aliases?.length > 0) {
        result += `   别名: ${arcade.aliases.join(", ")}\n`;
      }

      result += `   当前 ${arcade.current} 人\n`;

      if (arcade.average > 0 && arcade.totalUpdates > 1) {
        result += `   平均 ${arcade.average.toFixed(2)} 人\n`;
      }

      result += `   由 ${arcade.lastUpdater} 更新于 ${this.formatDateTime(
        arcade.lastUpdated
      )}\n`;

      if (arcade.isBound && arcade.sourceGroupId) {
        result += `   数据来源: ${arcade.sourceGroupId}\n`;
      }

      result += `\n`;
    });

    return result.trim();
  }

  // 获取所有机厅（包括绑定数据）
  private async getAllArcadesWithBinding(groupId: string): Promise<Arcade[]> {
    const localArcades = await this.ctx.database.get("arcade", { groupId });

    const binding = await this.getGroupBinding(groupId);
    let boundArcades: Arcade[] = [];

    if (binding?.isEnabled) {
      const sourceArcades = await this.ctx.database.get("arcade", {
        groupId: binding.sourceGroupId,
      });
      boundArcades = sourceArcades.map((a) => ({
        ...a,
        isBound: true,
        sourceGroupId: binding.sourceGroupId,
      }));
    }

    return [...localArcades, ...boundArcades];
  }

  // 添加机厅（需要权限）
  async addArcade(
    name: string,
    aliases: string[],
    groupId: string,
    session: any
  ) {
    // 检查权限
    if (!(await this.checkPermission(session))) {
      throw new Error("❌ 您没有权限添加机厅");
    }

    if (!name?.trim()) {
      throw new Error("机厅名称不能为空");
    }

    name = name.trim();

    // 检查是否已存在
    const existing = await this.ctx.database.get("arcade", {
      name,
      groupId,
    });

    if (existing.length > 0) {
      throw new Error(`机厅 "${name}" 已存在`);
    }

    // 验证别名
    if (aliases.length > this.config.maxAliasesPerArcade) {
      throw new Error(`别名数量不能超过 ${this.config.maxAliasesPerArcade} 个`);
    }

    // 检查别名唯一性
    const localArcades = await this.ctx.database.get("arcade", { groupId });
    for (const alias of aliases) {
      for (const arcade of localArcades) {
        if (arcade.aliases?.includes(alias)) {
          throw new Error(`别名 "${alias}" 已被机厅 "${arcade.name}" 使用`);
        }
      }
    }

    const now = new Date();
    const arcade = await this.ctx.database.create("arcade", {
      name,
      aliases,
      current: 0,
      average: 0,
      totalUpdates: 0,
      totalPeople: 0,
      lastUpdated: now,
      lastUpdater: "系统",
      updaterId: "system",
      groupId,
      sourceGroupId: null,
      createdAt: now,
      updatedAt: now,
      isBound: false,
    });

    // 添加历史记录
    await this.ctx.database.create("arcade_history", {
      arcadeId: arcade.id,
      count: 0,
      updater: "系统",
      updaterId: "system",
      groupId,
      updatedAt: now,
    });

    this.ctx.logger.info(`QQ群 ${groupId} 添加机厅: ${name}`);

    return {
      success: true,
      message: `✅ 机厅 "${name}" 添加成功`,
      data: {
        id: arcade.id,
        name: arcade.name,
        aliases: arcade.aliases,
        current: arcade.current,
        createdAt: this.formatDateTime(arcade.createdAt),
      },
    };
  }

  // 更新排队人数（无需权限）
  async updateQueue(query: string, count: number, session: any) {
    const groupId = this.getGroupId(session);
    const userId = this.getUserId(session);
    const updater = session?.username || session?.userId || "未知用户";

    // 查找机厅
    const arcade = await this.findArcade(query, groupId);
    if (!arcade) {
      throw new Error(`未找到机厅 "${query}"`);
    }

    // 验证人数
    if (count < 0) {
      throw new Error("排队人数不能为负数");
    }

    // 如果是绑定数据，创建本地副本
    let targetArcade = arcade;
    if (arcade.isBound && arcade.sourceGroupId) {
      const existing = await this.ctx.database.get("arcade", {
        name: arcade.name,
        groupId,
      });

      if (existing.length > 0) {
        targetArcade = existing[0];
      } else {
        const now = new Date();
        const localCopy = await this.ctx.database.create("arcade", {
          name: arcade.name,
          aliases: arcade.aliases,
          current: arcade.current,
          average: arcade.average,
          totalUpdates: arcade.totalUpdates,
          totalPeople: arcade.totalPeople,
          lastUpdated: arcade.lastUpdated,
          lastUpdater: arcade.lastUpdater,
          updaterId: arcade.updaterId,
          groupId,
          sourceGroupId: arcade.sourceGroupId,
          createdAt: now,
          updatedAt: now,
          isBound: false, // 本地副本不是绑定数据
        });
        targetArcade = localCopy;
      }
    }

    const now = new Date();
    const newTotalUpdates = targetArcade.totalUpdates + 1;
    const newTotalPeople = targetArcade.totalPeople + count;
    const newAverage =
      newTotalUpdates > 0 ? newTotalPeople / newTotalUpdates : 0;

    await this.ctx.database.set(
      "arcade",
      { id: targetArcade.id },
      {
        current: count,
        average: parseFloat(newAverage.toFixed(2)),
        totalUpdates: newTotalUpdates,
        totalPeople: newTotalPeople,
        lastUpdated: now,
        lastUpdater: updater,
        updaterId: userId,
        updatedAt: now,
      }
    );

    // 添加历史记录
    await this.ctx.database.create("arcade_history", {
      arcadeId: targetArcade.id,
      count,
      updater,
      updaterId: userId,
      groupId,
      updatedAt: now,
    });

    this.ctx.logger.info(
      `QQ群 ${groupId} 机厅 "${targetArcade.name}" 更新: ${count} 人`
    );

    return {
      success: true,
      message: this.formatArcadeInfo(targetArcade, {
        current: count,
        average: parseFloat(newAverage.toFixed(2)),
        lastUpdated: now,
        lastUpdater: updater,
        totalUpdates: newTotalUpdates,
      }),
      data: {
        id: targetArcade.id,
        name: targetArcade.name,
        current: count,
        lastUpdater: updater,
        lastUpdated: now,
        isBound: arcade.isBound,
      },
    };
  }

  // 获取机厅信息
  async getArcadeInfo(query: string, groupId: string): Promise<string> {
    const arcade = await this.findArcade(query, groupId);
    if (!arcade) {
      return `未找到机厅 "${query}"`;
    }

    return this.formatArcadeInfo(arcade, {
      current: arcade.current,
      average: arcade.average,
      lastUpdated: arcade.lastUpdated,
      lastUpdater: arcade.lastUpdater,
      totalUpdates: arcade.totalUpdates,
    });
  }

  // 列出所有机厅
  async listAllArcades(groupId: string): Promise<string> {
    const allArcades = await this.getAllArcadesWithBinding(groupId);

    if (allArcades.length === 0) {
      return '当前没有机厅数据，请使用"添加机厅"功能添加第一个机厅。';
    }

    // 排序
    const sortedArcades = allArcades.sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    let result = `📋 所有机厅 (共 ${sortedArcades.length} 个):\n\n`;

    sortedArcades.forEach((arcade, index) => {
      result += `${index + 1}. ${arcade.name}`;
      if (arcade.isBound) {
        result += ` [绑定数据]`;
      }
      result += `\n`;

      if (arcade.aliases?.length > 0) {
        result += `   别名: ${arcade.aliases.join(", ")}\n`;
      }

      result += `   当前 ${arcade.current} 人\n`;
      result += `   最后更新: ${this.formatDateTime(arcade.lastUpdated)}\n\n`;
    });

    return result.trim();
  }

  // 格式化机厅信息
  private formatArcadeInfo(
    arcade: Arcade,
    info: {
      current: number;
      average: number;
      lastUpdated: Date;
      lastUpdater: string;
      totalUpdates: number;
    }
  ): string {
    let result = `${arcade.name}`;
    if (arcade.isBound) {
      result += ` [绑定数据]`;
    }
    result += `\n`;

    if (arcade.aliases?.length > 0) {
      result += `别名: ${arcade.aliases.join(", ")}\n`;
    }

    result += `当前 ${info.current} 人\n`;

    if (info.average > 0 && info.totalUpdates > 1) {
      result += `平均 ${info.average.toFixed(2)} 人\n`;
    }

    result += `由 ${info.lastUpdater} 更新于 ${this.formatDateTime(
      info.lastUpdated
    )}\n`;

    if (arcade.isBound && arcade.sourceGroupId) {
      result += `数据来源: ${arcade.sourceGroupId}\n`;
    }

    return result.trim();
  }

  // ==================== 群聊绑定相关方法 ====================

  // 获取群聊绑定设置
  async getGroupBinding(groupId: string): Promise<GroupBinding | null> {
    const [binding] = await this.ctx.database.get("group_binding", {
      targetGroupId: groupId,
    });
    return binding || null;
  }

  // 设置群聊绑定（需要权限）
  async setGroupBinding(
    targetGroupId: string,
    sourceGroupId: string,
    enable: boolean,
    session: any
  ) {
    // 检查权限
    if (!(await this.checkPermission(session))) {
      throw new Error("❌ 您没有权限绑定群聊");
    }

    const existing = await this.getGroupBinding(targetGroupId);
    const now = new Date();

    if (existing) {
      await this.ctx.database.set(
        "group_binding",
        { id: existing.id },
        {
          sourceGroupId,
          isEnabled: enable,
          updatedAt: now,
        }
      );
    } else {
      await this.ctx.database.create("group_binding", {
        sourceGroupId,
        targetGroupId,
        isEnabled: enable,
        createdAt: now,
        updatedAt: now,
      });
    }

    this.ctx.logger.info(
      `QQ群 ${targetGroupId} 绑定设置更新: ${
        enable ? "绑定到" : "解绑"
      } ${sourceGroupId}`
    );

    return {
      success: true,
      message: enable
        ? `✅ 已绑定到QQ群 ${sourceGroupId} 的机厅数据`
        : `✅ 已关闭QQ群绑定功能`,
      data: { targetGroupId, sourceGroupId, enabled: enable },
    };
  }

  // 解绑群聊（需要权限）
  async unbindGroup(session: any) {
    // 检查权限
    if (!(await this.checkPermission(session))) {
      throw new Error("❌ 您没有权限解绑群聊");
    }

    const groupId = this.getGroupId(session);

    // 获取当前绑定设置
    const binding = await this.getGroupBinding(groupId);
    if (!binding || !binding.isEnabled) {
      throw new Error("❌ 当前没有绑定任何群聊");
    }

    const sourceGroupId = binding.sourceGroupId;

    // 删除绑定设置
    await this.ctx.database.remove("group_binding", {
      targetGroupId: groupId,
    });

    // 删除通过绑定添加的机厅（isBound为true且sourceGroupId为绑定源的机厅）
    const boundArcades = await this.ctx.database.get("arcade", {
      groupId,
      isBound: true,
      sourceGroupId: sourceGroupId,
    });

    if (boundArcades.length > 0) {
      // 先删除相关历史记录
      for (const arcade of boundArcades) {
        await this.ctx.database.remove("arcade_history", {
          arcadeId: arcade.id,
        });
      }

      // 删除机厅
      await this.ctx.database.remove("arcade", {
        groupId,
        isBound: true,
        sourceGroupId: sourceGroupId,
      });
    }

    this.ctx.logger.info(
      `QQ群 ${groupId} 解绑群聊 ${sourceGroupId}，删除了 ${boundArcades.length} 个绑定机厅`
    );

    return {
      success: true,
      message: `✅ 已解绑群聊 ${sourceGroupId}\n删除了 ${boundArcades.length} 个绑定机厅`,
      data: {
        groupId,
        sourceGroupId,
        deletedArcades: boundArcades.length,
      },
    };
  }

  // ==================== 管理功能（需要权限） ====================

  // 重置群聊数据（需要权限）
  async resetGroupData(session: any, confirmation: string) {
    // 检查权限
    if (!(await this.checkPermission(session))) {
      throw new Error("❌ 您没有权限重置数据");
    }

    const groupId = this.getGroupId(session);

    // 二次确认
    if (confirmation !== this.config.resetConfirmationText) {
      throw new Error(
        `请输入正确的确认文本："${this.config.resetConfirmationText}"`
      );
    }

    // 获取数据量
    const arcadeCount = await this.ctx.database
      .select("arcade")
      .where({ groupId })
      .execute()
      .then((rows) => rows.length);

    const historyCount = await this.ctx.database
      .select("arcade_history")
      .where({ groupId })
      .execute()
      .then((rows) => rows.length);

    // 删除数据
    await this.ctx.database.remove("arcade_history", { groupId });
    await this.ctx.database.remove("arcade", { groupId });
    await this.ctx.database.remove("group_binding", { targetGroupId: groupId });
    await this.ctx.database.remove("white_list", { groupId });

    // 清理定时器
    if (this.timers.has(groupId)) {
      clearTimeout(this.timers.get(groupId));
      this.timers.delete(groupId);
    }

    this.ctx.logger.info(
      `QQ群 ${groupId} 数据已重置，执行者: ${session?.username || "未知"}`
    );

    return {
      success: true,
      message:
        `✅ 已重置本QQ群所有数据\n` +
        `清理了 ${arcadeCount} 个机厅、 ${historyCount} 条历史记录和所有白名单\n` +
        `执行者: ${session?.username || session?.userId || "未知"}\n` +
        `时间: ${this.formatDateTime(new Date())}`,
      data: {
        groupId,
        arcadeCount,
        historyCount,
        executor: session?.username || session?.userId || "未知",
      },
    };
  }

  // 清除所有数据（管理员功能）
  async clearAllData(session: any, confirmation: string) {
    // 直接调用 resetGroupData
    return await this.resetGroupData(session, confirmation);
  }

  // 重置所有机厅人数（清零）
  async resetAllArcades(groupId: string, updater: string = "自动清零") {
    const arcades = await this.ctx.database.get("arcade", { groupId });
    if (arcades.length === 0) {
      return { success: true, message: "没有机厅可重置" };
    }

    const now = new Date();

    for (const arcade of arcades) {
      await this.ctx.database.set(
        "arcade",
        { id: arcade.id },
        {
          current: 0,
          lastUpdated: now,
          lastUpdater: updater,
          updaterId: "system",
          updatedAt: now,
        }
      );

      await this.ctx.database.create("arcade_history", {
        arcadeId: arcade.id,
        count: 0,
        updater,
        updaterId: "system",
        groupId,
        updatedAt: now,
      });
    }

    this.ctx.logger.info(`QQ群 ${groupId} 机厅人数已清零`);

    return {
      success: true,
      message: `✅ 已重置 ${arcades.length} 个机厅的人数为0`,
      data: {
        count: arcades.length,
        time: now,
        updater,
      },
    };
  }

  // 生成统计报告
  async generateReport(groupId: string): Promise<string> {
    const allArcades = await this.getAllArcadesWithBinding(groupId);

    if (allArcades.length === 0) {
      return "📊 系统状态：当前没有机厅数据";
    }

    const localArcades = allArcades.filter((a) => !a.isBound);
    const boundArcades = allArcades.filter((a) => a.isBound);

    const totalCurrent = allArcades.reduce((sum, a) => sum + a.current, 0);
    const totalUpdates = allArcades.reduce((sum, a) => sum + a.totalUpdates, 0);

    // 统计别名
    const aliasStats: Record<string, number> = {};
    allArcades.forEach((arcade) => {
      arcade.aliases?.forEach((alias) => {
        aliasStats[alias] = (aliasStats[alias] || 0) + 1;
      });
    });

    // 最拥挤的机厅
    const mostCrowded = allArcades.reduce((prev, current) =>
      prev.current > current.current ? prev : current
    );

    let result = "📊 机厅系统统计报告\n";
    result += "====================\n";
    result += `本群机厅数: ${localArcades.length}\n`;

    if (boundArcades.length > 0) {
      result += `绑定机厅数: ${boundArcades.length}\n`;
    }

    result += `总机厅数: ${allArcades.length}\n`;
    result += `总排队人数: ${totalCurrent}\n`;
    result += `总更新次数: ${totalUpdates}\n\n`;

    if (Object.keys(aliasStats).length > 0) {
      result += "🏷️ 别名统计:\n";
      Object.entries(aliasStats)
        .sort(([, a], [, b]) => b - a)
        .forEach(([alias, count]) => {
          result += `  ${alias} (${alias}j): ${count}个机厅\n`;
        });
      result += "\n";
    }

    result += `👥 最拥挤机厅: ${mostCrowded.name} (${mostCrowded.current}人)\n`;
    result += `🕒 报告生成时间: ${this.formatDateTime(new Date())}\n`;

    return result;
  }

  // 获取本群所有机厅（不包含绑定数据）
  async getAllArcades(groupId: string): Promise<Arcade[]> {
    return await this.ctx.database.get("arcade", { groupId });
  }

  // ==================== 定时任务 ====================

  // 设置自动清零定时任务
  private async setupAllAutoResets() {
    // 获取所有有数据的群聊
    const arcades = await this.ctx.database.select("arcade").execute();
    const groups = [...new Set(arcades.map((a) => a.groupId))];
    groups.forEach((groupId) => this.setupAutoReset(groupId));
  }

  private setupAutoReset(groupId: string) {
    const [hour, minute] = this.config.autoResetTime.split(":").map(Number);

    const calculateNextReset = () => {
      const now = new Date();
      const resetTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hour,
        minute,
        0,
        0
      );

      if (resetTime <= now) {
        resetTime.setDate(resetTime.getDate() + 1);
      }

      return resetTime.getTime() - now.getTime();
    };

    const scheduleReset = () => {
      const delay = calculateNextReset();
      const timer = setTimeout(async () => {
        try {
          await this.resetAllArcades(groupId, this.config.resetUpdater);
          this.ctx.logger.info(`QQ群 ${groupId} 机厅人数已自动清零`);
        } catch (error) {
          this.ctx.logger.error(`QQ群 ${groupId} 自动清零失败:`, error);
        }

        this.timers.set(groupId, scheduleReset());
      }, delay);

      return timer;
    };

    this.timers.set(groupId, scheduleReset());
  }

  // 停止所有定时器
  stop() {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }
}
