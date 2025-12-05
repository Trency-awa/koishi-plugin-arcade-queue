module.exports = {
  plugins: {
    // 基础插件
    database: {
      mysql: {
        host: "localhost",
        port: 3306,
        user: "root",
        password: "",
        database: "koishi",
      },
    },

    // 控制台
    console: {},

    // 网页界面
    webui: {},

    // Blockly 支持
    blockly: {},

    // 我们的机厅插件
    "./src/index": {
      autoResetTime: "04:00",
      resetUpdater: "自动清零",
      enableCommands: true,
      maxAliasesPerArcade: 5,
      adminRoles: ["admin", "owner"],
      resetConfirmationText: "确认重置所有数据",
    },
  },
};
