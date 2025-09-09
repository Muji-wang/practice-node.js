建立假的連線資料(本機 DynamoDB)
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
（可選：要保留資料）
docker run -d --name ddb-local -p 8000:8000 -v ddbdata:/home/dynamodblocal/data amazon/dynamodb-local -dbPath /home/dynamodblocal/data

