# NarraOps 发射与跟买外部配置清单

## 当前默认状态

- `REAL_EXECUTION_ENABLED=false`，真实广播关闭。
- 未配置 `WALLET_VAULT_PASSWORD` 时，不生成、解密或签名真实钱包。
- 自动化测试只使用模拟 RPC、测试密钥和内存交易，不转移真实资金。

## 启用前必须提供

1. `WALLET_VAULT_PASSWORD`：至少 16 位，建议 32 位以上随机字符。必须离线备份；修改时需要旧密码完成全量重新加密。
2. `SOLANA_RPC_URL`：支持主网交易提交和确认查询的稳定 Solana RPC。
3. `BSC_RPC_URL`：支持 `eth_call`、Gas 估算、交易提交和回执查询的稳定 BSC RPC。
4. `ROBINHOOD_RPC_URL`：Pons 发射及跟买使用的 Robinhood Chain RPC。
5. `PUMP_METADATA_UPLOAD_URL`：默认使用 `https://pump.fun/api/ipfs`；上线前需要再次验证可用性和上传限制。

## 本地持久化路径

- `WALLET_STORE_PATH=./data/wallet-vault.json`：只保存加密私钥信封。
- `WALLET_GROUP_STORE_PATH=./data/wallet-groups.json`：保存钱包组与公开地址、内部签名引用。
- `LAUNCH_EXECUTION_STORE_PATH=./data/launch-executions.json`：保存发射、确认、跟买状态和审计事件。

## 最终启用开关

只有完成小额验证、备份恢复演练和依赖风险处理后，才可设置：

```env
REAL_EXECUTION_ENABLED=true
```

## 当前阻断项

- 官方 Pump SDK 当前依赖树存在 6 个 high、7 个 moderate npm 漏洞；`npm audit fix --force` 会降级到破坏性版本，不能自动执行。生产广播保持关闭，直到官方依赖升级或完成隔离替换。
- 尚未接入正式用户认证、MFA/KMS/HSM 和数据库级不可变审计。当前本地加密仓适用于受控验证，不应直接作为公网多租户托管钱包服务。
- 必须先用全新小额钱包完成 Pump、Four.Meme、Pons 的逐平台验证，禁止使用主要资产钱包作为首次验证钱包。
