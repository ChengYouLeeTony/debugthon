# from browser import document, html
import os

def load_static():
  ['.DS_Store', 'brick.png', 'crate.png', 'dirt.png', 'ground.png', 'piglet.png', 'player.png', 'robot.png', 'wood.png']
  a = os.getcwd() + "/static/images"
  print(os.listdir(a))

load_static()