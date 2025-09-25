DynanoDB

1.GetItem：直接搜尋ID用。

2.Query：
    partition key，
    sort key：做篩選／排序
如果資料沒有主鍵  可以先建立GSI 便可直接使用Query做快速搜尋

3.Scan：整表掃描再過濾 正式環境避免使用 佔用資源過多

Primary Key（主鍵）: 資料專屬編號 大部分可以替代掉 Partition Key 

Partition Key(分割鍵) : 尋找資料時可以利用的 可以用騎快速搜尋 如果沒有主鍵可以建立GSI進行快速搜尋

Sort Key（排序鍵）: 用來在同一資料中裡排序、找範圍(目前沒有用到 會用到如尋找某學生近30天的資料)

sort key 與 partition key可以組合使用 這兩者組合後必須維持唯一

選擇時建立Partition必須尋找

GSI - Global Secondary Index(全域次要索引):用於建立一個快速搜尋的表 (尚未寫出程式碼) 可協助使用Query時快速搜尋並減少伺服器負擔 
    但也會因此佔用儲存空間 會因為更新而落後主表進度 根據用途不同會建立不同的資料表
LSI