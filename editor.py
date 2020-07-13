import tb
from browser import document, svg, timer, aio, bind, window

editor = None
def make_the_task_have_tab(task):
  task_list = task.split("\n")
  for i in range(len(task_list)):
    task_list[i] = "  " + task_list[i]
  task_output = "\n".join(task_list)
  return task_output

def create_editor():
    global editor
    if editor is None:
        editor = window.ace.edit("editor")
        editor.setTheme("ace/theme/dracula")
        editor.session.setMode("ace/mode/python")
        editor.session.setTabSize(2)
        editor.focus()
        editor.on("change", editor_changed)
        editor.setValue("for i in range(3):\n" + "  Amy.walk()")

        # editor.setValue("")
    return editor
def editor_changed(*args):
    """Called when the editor content changes."""
    current = document.select(".current")
    if current:
        filename = current[0].text.rstrip("*")
        if open_files[filename]["content"] != editor.getValue():
            if not current[0].text.endswith("*"):
                current[0].text += "*"
        elif current[0].text.endswith("*"):
            current[0].text = current[0].text.rstrip("*")

def main():
    for i in range(3):
      print(i)
main()