for i in {1..150}; do
  curl --location 'http://localhost:3000/api/me' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InpoYW5nc2FuQHFxLmNvbSIsInVpZCI6MjksInJvbGUiOm51bGwsImlhdCI6MTc3NzQzMTAyOSwiZXhwIjoxNzc3NTE3NDI5fQ.c7DdTllHS-7eypogDgxyobcqn5jwGD7USLyoNpTSOFE'
  echo "\n--- $i ---"
done