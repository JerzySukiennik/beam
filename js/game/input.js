// Beam: keyboard input for up to two local players.

const SOLO = [
  { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['ArrowUp', 'Space'], down: ['ArrowDown'], grab: ['ShiftLeft', 'ShiftRight'] },
];

const DUO = [
  { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['ArrowUp'], down: ['ArrowDown'], grab: ['ShiftRight', 'Slash', 'Enter'] },
  { left: ['KeyA'], right: ['KeyD'], jump: ['KeyW', 'Space'], down: ['KeyS'], grab: ['KeyE', 'KeyQ'] },
];

export const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft', 'ShiftRight', 'Slash', 'Enter', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyE', 'KeyQ']);

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
  }

  key(code, isDown) {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
    }
  }

  clear() {
    this.down.clear();
    this.pressed.clear();
  }

  player(i, count) {
    const m = (count > 1 ? DUO : SOLO)[i] || DUO[i];
    const any = list => list.some(c => this.down.has(c));
    return {
      left: any(m.left),
      right: any(m.right),
      jump: any(m.jump),
      jumpPressed: m.jump.some(c => this.pressed.has(c)),
      down: any(m.down),
      grab: any(m.grab),
    };
  }

  consume() {
    this.pressed.clear();
  }
}
