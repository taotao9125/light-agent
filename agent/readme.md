# 已实现的架构草图


![图片说明](./image.png)

## message
  - ai input: 我是什么角色，我发给你哪些内容，我有哪些工具。
  - ai output: assistant 角色，我返回什么内容，或者该调用什么工具（name），什么参数(args)。

## provider
  - 内部适配器模式抹平各厂商差异，工厂模式注册，外部通过 createClient 的 provider 去查找。

## tool
  - 我有哪些 tool，长什么样子（作用，参数，名字）。
  - Ai 告诉我该调用哪些 tool, 参数是什么。
