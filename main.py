from make_map import build_map
from spirit import spirit
from browser import document, svg, timer, aio
from browser.timer import request_animation_frame as raf
from browser.timer import cancel_animation_frame as caf
from time import time
from browser import document as doc
from browser import window as win

map_a = build_map(8)
map_a.make_ground_map(["wood", "dirt"])
map_a.make_special_ground_map([[1,0], [2,1]], "dirt")
map_a.prepare_to_draw()
top_x, left_y = (19, 25)
interval = map_a.return_canvas_interval()
Amy = spirit("robot", "./static/images/Actor3.png")
Amy.set_value(top_x, left_y, interval)
Amy.start(top=0, right=40, speed = 5)
# Amy.walk()


def main_flow(ev):
  global Amy
  ev = Amy.return_ev()
  Amy.turn_count = 0
  """以上使用者不可見"""
  Amy.walk()
  Amy.walk()
  Amy.turn_right()
  Amy.turn_right()
  # Amy.turn_right()
  # Amy.turn_left()
  # Amy.turn_left()
  # Amy.turn_left()
  # Amy.walk(ev)
  # Amy.turn_right(ev)
  # Amy.walk(ev)
  # Amy.turn_left(ev)
document['btn-invisible'].bind('click', main_flow)