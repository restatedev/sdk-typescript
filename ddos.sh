while true; do
curl -s --request POST \
  --url http://10.77.33.148:8080/Greeter/greet/send \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'idempotency-key: ' \
  --data '{
  "name": "string"
}' -o /dev/null &
done


