class Queue:
  def __init__(self):
    self.items = []

  def isEmpty(self):
    if self.items ==[]:
      return True
    else :
      return False
  def enqueue(self, item): # 從list index = 0 處開始加入item
    self.items.insert(0,item)

  def dequeue(self):       # 從list index = -1 處del item
    self.items.pop()

  def size(self):
    return len(self.items)

def get_position(element):
  x = 0
  y = 0
  while element:
    x += element.offsetLeft - element.scrollLeft + element.clientLeft
    y += element.offsetTop - element.scrollLeft + element.clientTop
    element = element.offsetParent
  return x, y
