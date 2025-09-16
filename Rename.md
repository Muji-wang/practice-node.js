建立假的連線資料(本機 DynamoDB) 在docker 的印象檔提取 模擬AWS雲端運作
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local

（可選：要保留資料）
docker run -d --name ddb-local -p 8000:8000 -v ddbdata:/home/dynamodblocal/data amazon/dynamodb-local -dbPath /home/dynamodblocal/data

week1
練習建立假資料並且建立一個可以依次讀取並複製成新檔案
week2
練習 如何抓出開頭為Ａ的user
練習 根據字母順序排序名字
練習 抓出特定一個名字（尚未完成）