from browser import alert, document, html, aio

async def main():
  input = html.INPUT()
  document <= input
  while True:
    ev = await aio.event(input, "blur")
    try:
        v = int(ev.target.value)
        input.remove()
        alert(f"Value: {v}")
        print(1)
        break
    except ValueError:
        input.value = ""

aio.run(main())
for i in range(5):
  print (i)

