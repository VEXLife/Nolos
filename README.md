# Nolos系列程序
## 1. Nolos五子棋
这是一个基于JavaScript的低性能五子棋游戏，带有简易的传统计算机玩家。

* ### 业余版
演示版本[点此即玩](https://vexlife.github.io/Nolos/nolos_amat.html)。<br>
目前水平较低，仅有一步的思考深度，尚在测试Bug阶段。

* ### 专业版
演示版本[点此即玩](https://vexlife.github.io/Nolos/nolos_pro.html)。<br>
尚在开发中的较高水平版本，拥有6步的思考深度。与大多数同类棋软相比，仍需改进。


#### 关于代码的说明
--
```
function search(player,depth)
```
搜索算法函数，返回当前局面下的评分值（浮点小数）。

* `player`：被评分的玩家，应为`black`或`white`中的一个。
* `depth`：搜索深度。您可以通过增大此数值来提高计算机的棋力，但更高的数值意味着更长的搜索时间。在本程序中，它被设置为6。<br>
它被要求按照下面的公式输出（搜索广度只有3）：
$$\sum_{i=0}^{\mathrm {depth}+1}(-1)^i\max[\mathrm{eval}(\mathrm{每个点,当前玩家})]$$

* ### 用户
包括但不限于宰、拐。
