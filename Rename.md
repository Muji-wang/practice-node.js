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
練習 建立一個Table 追蹤學生有看過什麼URL 並依照相關設定分級URL等級（需先建立好URL分類）
    ＵＲＬ分級最好越簡單越好（用１２３４５去分類 １２３４５可分別代表社群 影片...
    以及如何join

介紹 DynanoDB如何處理與相關的API
理解 DynanoDB相關處理(在伺服器端處理後再取得相關資料)
    Export to S3（雲端 DynamoDB 支援 PITR Export 到 S3，輸出 Parquet/JSON），
    用 Athena/Glue/Spark 做排序、Join、聚合，再導回你要的產物（CSV/Parquet/JSON）。

    AWS SDK for JavaScript v3（Node.js）
    paginateScan, paginateQuery：高效分頁迭代器（建議首選）
    ScanCommand with Segment/TotalSegments：Parallel Scan
    QueryCommand：配合 GSI，精準命中分區，避免掃表
    
次要練習 抓出特定一個名字（尚未完成）
