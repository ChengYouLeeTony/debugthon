from make_map import build_map
from spirit import spirit
from console import Console
from editor import create_editor, make_the_task_have_tab

import tb
from browser import document, svg, timer, aio, bind, window
from browser.timer import request_animation_frame as raf
from browser.timer import cancel_animation_frame as caf
from time import time
from browser import document as doc
from browser import window as win

def main_flow(ev):
  global Amy
  Amy.turn_count = 0
  """以上使用者不可見"""
  Amy.walk()
  Amy.walk()
  Amy.walk()
  Amy.walk()
  Amy.turn_right()
  Amy.turn_right()
  Amy.turn_right()
  Amy.turn_right()
  Amy.walk()
  Amy.turn_left()
  Amy.turn_left()
  Amy.turn_left()
  Amy.turn_left()
  # Amy.walk(ev)
  # Amy.turn_right(ev)
  # Amy.walk(ev)
  # Amy.turn_left(ev)

def test(ev):
  cmd = """
  def a():
    Amy.walk()
    Amy.walk()
    Amy.walk()
    Amy.walk()
    Amy.turn_right()
    Amy.turn_right()
    Amy.turn_right()
    Amy.turn_right()
    Amy.walk()
    Amy.turn_left()
    Amy.turn_left()
    Amy.turn_left()
    Amy.turn_left()
  a()
  for i in range(2):
    print(i)
  """
  eval(cmd)

@bind("#btn-run", "click")
def run(evt):
    """Run the script and start the interactive session in the console with
    the script namespace."""
    output.clear()
    task = editor.getValue()
    task_output = make_the_task_have_tab(task)
    pre_setting = "Amy.turn_count = 0\n"
    cmd = "def main():\n" + task_output + "\nmain()"
    cmd = pre_setting + cmd
    try:
        eval(cmd)
    except:
        tb.print_exc(file=output)
    output.prompt()

if __name__ == '__main__':
  map_a = build_map(mapsize = 8, canvas_size_px = 320)
  map_a.make_ground_map(["wood", "dirt"])
  map_a.make_special_ground_map([[1,0], [2,1]], "dirt")
  map_a.prepare_to_draw()
  top_x, left_y = (26, 20)
  interval = map_a.return_canvas_interval()
  Amy = spirit()
  # Amy.walk()
  # Create the interactive Python console
  output = Console(document["console"])
  output.prompt()
  """bind button"""
  document['btn-start'].bind('click', main_flow)
  document['btn-test'].bind('click', test)

  editor = create_editor()
