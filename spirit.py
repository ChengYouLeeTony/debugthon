from browser.timer import request_animation_frame as raf
from browser.timer import cancel_animation_frame as caf
from browser import document, html, aio
from time import time
from browser import timer
from browser import window as win
import math
from util import Queue

class spirit():
  def __init__(self, name = "robot", src = "./static/images/Actor3.png", img_size = 48, top_x = 26, left_y = 20, interval = 40, top=0, right=40, speed = 10):
    self.name = name
    self.src = src
    self.img_size = img_size
    self.img = None
    """top_x left_y 紀錄canvas左上角"""
    self.top_x = None
    self.left_y = None
    self.interval = None
    """紀錄spirit面朝的方向 1為上2為右3為下4為左 預設為面朝下"""
    self.direction = 3
    self.is_upper_half = None
    self.clip_right = None
    self.animation_count = 0
    self.animation_start_time = None
    """隨便給一個ev值 None也可以"""
    self.ev = win.MouseEvent.new("click")
    """is_walk == True時代表正在進行動畫walk_an_interval"""
    self.is_walk = False
    self.duration = None
    """紀錄spirit動畫開始前的起始位置"""
    self.spirit_top_now = None
    self.spirit_left_now = None
    """紀錄左轉、右轉、迴轉正在被執行的次數"""
    self.turn_count = 0
    """執行Amy.set_value top_x left_y代表起點 interval代表一格大小px speed代表動畫運行速度"""
    self.set_value(top_x, left_y, interval, speed)
    """top right代表切圖的位置"""
    self.start(top, right)
  def set_value(self, top_x, left_y, interval, speed):
    self.top_x = top_x
    self.left_y = left_y
    self.interval = interval
    self.speed = speed
    """紀錄該spirit的speed 1000 / speed == duration"""
    self.duration = 1000 / self.speed
  def set_speed(self, speed):
    self.speed = speed
    self.duration = 1000 / self.speed
  def start(self, top, right):
    self.img = html.IMG(src = self.src, id = self.name, width = self.interval * 12, height = self.interval * 8)
    document["canvas_parent"] <= self.img
    style = self.img.style
    self.is_upper_half = (True if top == 0 else False)
    clip_top = str(top) + "px"
    clip_right = str(right) + "px"
    clip_down = str(int(clip_top[:-2]) + self.interval) + "px"
    clip_left = str(int(clip_right[:-2]) - self.interval) + "px"
    style.clip = f'rect({clip_top},{clip_right},{clip_down},{clip_left})'
    style.position = "absolute"
    style.left = str(self.top_x) + "px"
    style.top = str(self.left_y) + "px"
    style.pointerEvents = "none"
    """連結按鈕到可以動"""
    document['btn-turn-left'].bind('click', self.turn_left1)
    document['btn-turn-right'].bind('click', self.turn_right1)
    document['btn-turn-over'].bind('click', self.turn_over1)
    document['btn-walk'].bind('click', self.walk1)
    """紀錄該spirit的clip_right、clip_top位置以供後續使用"""
    self.clip_top = clip_top
    self.clip_right = clip_right
  def walk_an_interval(self):
    """duration 走一步的動畫時長，單位為ms"""
    style = self.img.style
    top_now = self.spirit_top_now
    left_now = self.spirit_left_now
    """step: spirit的位移量"""
    step = (time() * 1000 - self.animation_start_time) / self.duration * self.interval
    if self.direction == 1:
      style.top = str(top_now - step) + "px"
    if self.direction == 2:
      style.left = str(left_now + step) + "px"
    if self.direction == 3:
      style.top = str(top_now + step) + "px"
    if self.direction == 4:
      style.left = str(left_now - step) + "px"
    if step >= self.interval:
      if self.direction == 1:
        style.top = str(top_now - self.interval) + "px"
      if self.direction == 2:
        style.left = str(left_now + self.interval) + "px"
      if self.direction == 3:
        style.top = str(top_now + self.interval) + "px"
      if self.direction == 4:
        style.left = str(left_now - self.interval) + "px"
      self.animation_count = 0
      self.is_walk = False
      self.stop()
  def walk(self):
    self.turn_count += 1
    timer.set_timeout(self.walk1, self.turn_count*self.duration*2)
  def walk1(self, ev=None):
    aio.run(self.walk2())
  async def walk2(self):
    while self.is_walk == True:
      await aio.sleep(self.duration*2 / 1000)
    else:
      self.is_walk = True
      style = self.img.style
      self.animation_start_time = time() * 1000
      self.spirit_top_now = float(style.top[:-2])
      self.spirit_left_now = float(style.left[:-2])
      # print(self.animation_start_time)
      self.walk_repeat()
  def walk_repeat(self, ev=None):
    global id
    id = raf(self.walk_repeat)
    self.walk_an_interval()
  def return_ev(self):
    return self.ev
  def stop(self, ev=None):
    global id
    caf(id)
  def change_spirit_direction_img(self):
    if self.is_upper_half == True:
      bias = 0
    else:
      bias = 4
    direction_dict = {1 : str(self.interval*(3+bias))+"px", 2 : str(self.interval*(2+bias))+"px", \
                      3 : str(self.interval*(0+bias))+"px", 4 : str(self.interval*(1+bias))+"px"}
    style = self.img.style
    clip_top = direction_dict[self.direction]
    clip_right = self.clip_right
    clip_down = str(int(clip_top[:-2]) + self.interval) + "px"
    clip_left = str(int(clip_right[:-2]) - self.interval) + "px"
    style.clip = f'rect({clip_top},{clip_right},{clip_down},{clip_left})'
  def change_spirit_time_img(self):
    """todo"""
    style = self.img.style
    clip_top = self.clip_top
    clip_right = self.clip_right + self.interval
    clip_down = str(int(clip_top[:-2]) + self.interval) + "px"
    clip_left = str(int(clip_right[:-2]) - self.interval) + "px"
    style.clip = f'rect({clip_top},{clip_right},{clip_down},{clip_left})'
  def turn_left(self):
    self.turn_count += 1
    timer.set_timeout(self.turn_left1, self.turn_count*self.duration*2)
  def turn_left1(self, ev = None):
    aio.run(self.turn_left2())
  async def turn_left2(self):
    while self.is_walk == True:
      await aio.sleep(self.duration*2 / 1000)
    else:
      self.is_walk = True
      style = self.img.style
      self.direction -= 1
      if self.direction == 0:
        self.direction = 4
      self.change_spirit_direction_img()
      if self.direction == 1:
        style.top = str(int(style.top[:-2]) - self.interval*1) + "px"
      elif self.direction == 2:
        style.top = str(int(style.top[:-2]) - self.interval*2) + "px"
      elif self.direction == 3:
        style.top = str(int(style.top[:-2]) + self.interval*1) + "px"
      elif self.direction == 4:
        style.top = str(int(style.top[:-2]) + self.interval*2) + "px"
      self.is_walk = False
  def turn_right(self):
    self.turn_count += 1
    timer.set_timeout(self.turn_right1, self.turn_count*self.duration*2)
  def turn_right1(self, ev=None):
    aio.run(self.turn_right2())
  async def turn_right2(self):
    while self.is_walk == True:
      await aio.sleep(self.duration*2 / 1000)
    else:
      self.is_walk = True
      style = self.img.style
      self.direction += 1
      if self.direction == 5:
        self.direction = 1
      self.change_spirit_direction_img()
      if self.direction == 1:
        style.top = str(int(style.top[:-2]) - self.interval*2) + "px"
      elif self.direction == 2:
        style.top = str(int(style.top[:-2]) + self.interval*1) + "px"
      elif self.direction == 3:
        style.top = str(int(style.top[:-2]) + self.interval*2) + "px"
      elif self.direction == 4:
        style.top = str(int(style.top[:-2]) - self.interval*1) + "px"
      self.is_walk = False
  def turn_over(self):
    self.turn_count += 1
    timer.set_timeout(self.turn_over1, self.turn_count*self.duration*2)
  def turn_over1(self, ev=None):
      aio.run(self.turn_over2())
  async def turn_over2(self):
    while self.is_walk == True:
      await aio.sleep(self.duration*2 / 1000)
    else:
      self.is_walk = True
      style = self.img.style
      self.direction += 2
      if self.direction == 5:
        self.direction = 1
      elif self.direction == 6:
        self.direction = 2
      self.change_spirit_direction_img()
      if self.direction == 1:
        style.top = str(int(style.top[:-2]) - self.interval*3) + "px"
      elif self.direction == 2:
        style.top = str(int(style.top[:-2]) - self.interval*1) + "px"
      elif self.direction == 3:
        style.top = str(int(style.top[:-2]) + self.interval*3) + "px"
      elif self.direction == 4:
        style.top = str(int(style.top[:-2]) + self.interval*1) + "px"
      self.is_walk = False



