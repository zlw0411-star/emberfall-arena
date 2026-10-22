# 待启用的 GitHub Actions

`verify.yml` 已准备并通过本地YAML结构检查，包含Node22/24完整回归、真实Chrome检查和24局首领矩阵。

2026-10-22推送时，GitHub拒绝了`.github/workflows/verify.yml`：当前OAuth凭据没有`workflow`权限。为先交付游戏和试玩，本配置暂作为普通文档保留，**当前不会自动运行**。不是测试失败，也不影响本地`npm run verify`和`npm run test:browser`。

完成GitHub交互授权后可启用：

```sh
gh auth refresh --hostname github.com --scopes workflow
mkdir -p .github/workflows
git mv docs/ci/verify.yml .github/workflows/verify.yml
git commit -m "ci: enable game regression workflow"
git push github main
```

授权需由账户所有者在GitHub完成；不要将token贴入文档或聊天。启用后应核对首轮Actions结果，再更新README与验证记录中的待启用说明。
