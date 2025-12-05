import { Context, Schema } from "koishi";

export const name = "arcade-queue";

export const Config = Schema.object({
  autoResetTime: Schema.string()
    .default("04:00")
    .description("自动清零时间 (格式: HH:mm，如 04:00 表示凌晨4点)"),

  resetUpdater: Schema.string()
    .default("自动清零")
    .description("自动清零时的更新者名称"),

  requireConfirmation: Schema.boolean()
    .default(true)
    .description("删除操作需要确认（防止误操作）"),

  enableCommands: Schema.boolean()
    .default(true)
    .description("启用聊天命令（如 机厅添加、机厅查询等）"),

  maxAliasesPerArcade: Schema.number()
    .default(5)
    .min(1)
    .max(20)
    .description("每个机厅最大别名数量"),

  adminRoles: Schema.array(Schema.string())
    .default(["admin", "owner"])
    .description("管理员角色（需要管理员权限的操作：重置、绑定等）"),

  resetConfirmationText: Schema.string()
    .default("确认重置所有数据")
    .description("重置数据时需要输入的确认文本（防止误操作）"),

  // 新增白名单配置
  enableWhiteList: Schema.boolean()
    .default(false)
    .description(
      "启用白名单功能（关闭时仅群主/管理员可执行权限操作，开启时仅群主/白名单成员可执行权限操作）"
    ),

  whiteListRequireAdmin: Schema.boolean()
    .default(true)
    .description("白名单管理需要管理员权限（关闭则任何人都可管理白名单）"),
});

export const inject = ["database"];

export interface Config {
  autoResetTime: string;
  resetUpdater: string;
  requireConfirmation: boolean;
  enableCommands: boolean;
  maxAliasesPerArcade: number;
  adminRoles: string[];
  resetConfirmationText: string;
  enableWhiteList: boolean;
  whiteListRequireAdmin: boolean;
}

export interface Arcade {
  id: number;
  name: string;
  aliases: string[];
  current: number;
  average: number;
  totalUpdates: number;
  totalPeople: number;
  lastUpdated: Date;
  lastUpdater: string;
  updaterId: string;
  groupId: string;
  sourceGroupId: string | null;
  createdAt: Date;
  updatedAt: Date;
  isBound: boolean;
}

export interface ArcadeHistory {
  id: number;
  arcadeId: number;
  count: number;
  updater: string;
  updaterId: string;
  groupId: string;
  updatedAt: Date;
}

export interface GroupBinding {
  id: number;
  sourceGroupId: string;
  targetGroupId: string;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhiteListUser {
  id: number;
  userId: string;
  userName: string;
  groupId: string;
  addedBy: string;
  addedByName: string;
  createdAt: Date;
  updatedAt: Date;
}
