from browser import document, alert, html

calc = html.TABLE()
calc <= html.TR(html.TH(html.DIV("0", id="result"), colspan=3) +
                html.TD("C"))
lines = ["789/", "456*", "123-", "0.=+"]

calc <= (html.TR(html.TD(x) for x in line) for line in lines)

document <= calc
result = document["result"] # direct acces to an element by its id

def action(event):
    """Handles the "click" event on a button of the calculator."""
    # The element the user clicked on is the attribute "target" of the
    # event object
    element = event.target
    # The text printed on the button is the element's "text" attribute
    value = element.text
    print("11")
    if value not in "=C":
        # update the result zone
        if result.text in ["0", "error"]:
            result.text = value
        else:
            result.text = result.text + value
    elif value == "C":
        # reset
        result.text = "0"
    elif value == "=":
        # execute the formula in result zone
        try:
            result.text = eval(result.text)
        except:
            result.text = "error"

# Associate function action() to the event "click" on all buttons
for button in document.select("td"):
    button.bind("click", action)

def hello(ev):
    alert("Hello !")

document["button_alert"].bind("click", hello)