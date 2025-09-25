建立假的連線資料(本機 DynamoDB) 在docker 的印象檔提取 模擬AWS雲端運作
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local

（可選：要保留資料）
docker run -d --name ddb-local -p 8000:8000 -v ddbdata:/home/dynamodblocal/data amazon/dynamodb-local -dbPath /home/dynamodblocal/data

week1
練習建立假資料並且建立一個可以依次讀取並複製成新檔案
week2
練習 如何抓出開頭為Ａ的user
練習 根據字母順序排序名字
week3 

介紹 DynanoDB如何處理與相關的API**
理解 DynanoDB相關處理(在伺服器端處理後再取得相關資料)
    Export to S3（雲端 DynamoDB 支援 PITR Export 到 S3，輸出 Parquet/JSON），
    用 Athena/Glue/Spark 做排序、Join、聚合，再導回你要的產物（CSV/Parquet/JSON）。

    AWS SDK for JavaScript v3（Node.js）
    paginateScan, paginateQuery：高效分頁迭代器（建議首選）
    ScanCommand with Segment/TotalSegments：Parallel Scan
    QueryCommand：配合 GSI，精準命中分區，避免掃表
    
次要練習 抓出特定一個名字（尚未完成）

week 4 
    建立一個Table 追蹤學生有看過什麼URL 並依照相關設定分級URL等級（需先建立好URL分類）
    ＵＲＬ分級最好越簡單越好（用１２３４５去分類 １２３４５可分別代表社群 影片...
    以及如何join
    建立兩個建立資料的 一個老師 一個學生 讀取這兩個表並且隨機分配老師對應學生 並新增老師對應學生的什麼課程 （至少為三個表）視本機情況使用 GSI
    如完成後可以再多加如住家位置 並建立 GSI 去進行分類
    GSI可建立用於需要多重分類 並且無法使用sort key 與partition key 直接分類 如學科的分類（文理科） 影片的分類（影片分類對應分類 對應廣告需分配什麼）