from browser import document, html
from browser import timer
from browser.template import Template
from util import get_position
import math

class build_map():
  def __init__(self, mapsize, canvas_size_px = 320):
    self.mapsize = mapsize
    self.ground_map = []
    self.ground_map_dict = {}
    self.ground_name_src_dict = {}
    self.canvas_height = canvas_size_px
    #一格大小
    self.interval = self.canvas_height // mapsize
    self.ground_name_list = []
    self.canvas = html.CANVAS(width=canvas_size_px, height=canvas_size_px, margin= 0, z_index=0)
    self.ctx = self.canvas.getContext("2d")
    self.top_x = None
    self.left_y = None
  def make_ground_map(self, ground_name_list):
    self.ground_name_list = ground_name_list
    """初始化ground map"""
    for i in range(self.mapsize):
      self.ground_map.append([])
      for j in range(self.mapsize):
        self.ground_map[i].append(0)
    """建立ground map dict"""
    for i in range(len(ground_name_list)):
      self.ground_map_dict[ground_name_list[i]] = i
    """建立ground name圖片對應的src"""
    for i in range(len(ground_name_list)):
      self.ground_name_src_dict[i] = "./static/images/" + ground_name_list[i] + ".png"
    """render索引值"""
    Template("t01").render(map_size = self.mapsize, interval = self.interval)
  def prepare_to_draw(self):
    """將需要用到的圖片載入，並設display為none"""
    for i in range(len(self.ground_name_list)):
      img_src = self.ground_name_src_dict[i]
      img = html.IMG(src = img_src, height = self.interval, id = self.ground_name_list[i])
      document <= img
      document[self.ground_name_list[i]].style.display = "none"
    """圖片載入後進行繪製"""
    document[self.ground_name_list[len(self.ground_name_list)-1]].bind("load", self.can_draw)
  def can_draw(self, ev):
    self.draw_ground()
    self.split_and_draw()
  def make_special_ground_map(self, special_ground_index_list, special_ground_name):
    """製作特殊方格"""
    for i in range(len(special_ground_index_list)):
      self.ground_map[special_ground_index_list[i][0]][special_ground_index_list[i][1]] = self.ground_map_dict[special_ground_name]
  def draw_ground(self):
    ctx = self.ctx
    """依據ground map和ground_map_dict來繪圖"""
    for i in range(self.mapsize):
      for j in range(self.mapsize):
        ground_category = self.ground_map[i][j]
        img = document[self.ground_name_list[ground_category]]
        ctx.drawImage(img, i * self.interval, j * self.interval, self.interval, self.interval)
    self.move_canvas_and_bind_mousemove()
  def split_and_draw(self):
    """畫方格線"""
    ctx = self.ctx
    interval = self.interval
    canvas_height = self.canvas_height
    for i in range(1, self.mapsize):
      ctx.beginPath()
      ctx.moveTo(interval * i, 0)
      ctx.lineTo(interval * i, canvas_height)
      ctx.closePath()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, interval * i)
      ctx.lineTo(canvas_height, interval * i)
      ctx.closePath()
      ctx.stroke()
  def move_canvas_and_bind_mousemove(self):
    """將畫好的canvas擺到table中正確的位置"""
    document["canvas_parent"] <= self.canvas
    self.canvas.bind("mousemove", self.mousemove)
    self.canvas.bind("mouseleave", self.mouseleave)
  def mousemove(self, ev):
    x, y = get_position(self.canvas)
    self.top_x = x
    self.left_y = y
    relative_x = ev.x - x
    relative_y = ev.y - y
    if relative_x == -1 or relative_y == -1:
      relative_x = 0
      relative_y = 0
    index_x = relative_x // self.interval
    index_y = relative_y // self.interval
    document["trace3"].text = f"[{index_y}, {index_x}]"
    """更改座標資訊位置"""
    document["trace3"].style.left = str(ev.x+10) + "px"
    document["trace3"].style.top = str(ev.y-30) + "px"
  def mouseleave(self, ev):
    document["trace3"].text = ""
  def return_canvas_interval(self):
    return self.interval
  def get_top_x_left_y(self):
    self.top_x, self.left_y = get_position(document["canvas_parent"])
    return self.top_x, self.left_y



