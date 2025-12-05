import "koishi";

declare module "koishi" {
  interface Tables {
    arcade: {
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
    };
    arcade_history: {
      id: number;
      arcadeId: number;
      count: number;
      updater: string;
      updaterId: string;
      groupId: string;
      updatedAt: Date;
    };
    group_binding: {
      id: number;
      sourceGroupId: string;
      targetGroupId: string;
      isEnabled: boolean;
      createdAt: Date;
      updatedAt: Date;
    };
    // 新增白名单表
    white_list: {
      id: number;
      userId: string;
      userName: string;
      groupId: string;
      addedBy: string;
      addedByName: string;
      createdAt: Date;
      updatedAt: Date;
    };
  }
}
