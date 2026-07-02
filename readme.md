
https://github.com/user-attachments/assets/78560566-6359-4a48-9eb4-a407cd146afc

-----------------------


# plan
## 工具层
### 原则, 当模型工具选错（unknown tool），传参数出错，工具执行出错，反馈给模型，不要退出进程
- 重构工具层注册, schema 强制为 zod object。
- 内置 grep(rg), find(fd) 工具, sed, shell 工具。
- 重构召回工具。
- 格式化工具的读取结果，错误信息，线索信心等。
- 路径逃逸问题。


## 事件协议
- 生命周期事件统一从 agent emit 出来

## event 坐标定义更改
- `event(round, turn) => event(turn, step)`


## 内存
- 内存不全量存 canonical event log, 保留最近两个 turn
  - 召回优先从 canonical event log, 如果没有，去 grep 文件。