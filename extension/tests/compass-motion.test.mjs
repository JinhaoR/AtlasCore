import test from 'node:test';
import assert from 'node:assert/strict';
import { angularMotion, coastRotation } from '../dist/lib/ui/compass-motion.js';

function sample(motion, angle, time, radius = 120) {
  return motion.move(radius * Math.cos(angle * Math.PI / 180), radius * Math.sin(angle * Math.PI / 180), time);
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('angular velocity follows pointer time and is independent of sample frequency and ring radius', () => {
  for (const step of [2, 5, 10, 20]) for (const radius of [30, 120, 150]) {
    const motion = angularMotion(); let angle = 0;
    for (let time = 0; time <= 100; time += step) angle += sample(motion, 170 + time * .4, time, radius);
    near(angle, 40); near(motion.velocity(100), .4);
  }
});
test('crossing the angle seam preserves direction; reversing the pointer changes the release direction', () => {
  const motion = angularMotion();
  sample(motion, 179, 0); near(sample(motion, -179, 20), 2);
  for (let time = 40; time <= 200; time += 20) sample(motion, 181 - (time - 20) * .5, time);
  near(motion.velocity(200), -.5);
});
test('paused release, tiny movements at the axis and invalid timestamps do not generate a fling', () => {
  const motion = angularMotion(); sample(motion, 0, 0); sample(motion, 60, 100);
  assert.equal(motion.velocity(200), 0);
  near(motion.move(1, 0, 201), 0); near(motion.move(-1, 0, 202), 0);
  near(sample(motion, 180, 210), 0); assert.equal(motion.velocity(210), 0);
  near(sample(motion, 90, 209), 0); near(sample(motion, 90, NaN), 0);
  assert.equal(motion.velocity(209), 0);
});
test('coarsened equal timestamps remain finite and release speed is bounded', () => {
  const motion = angularMotion(); sample(motion, 0, 0);
  sample(motion, 45, 0); assert.equal(motion.velocity(0), 0);
  sample(motion, 90, 20); assert.equal(motion.velocity(20), 1.2);
});
test('friction integrates equally at 30, 60 and 144 Hz and keeps a gentler bounded coast', () => {
  const exact = coastRotation(.6, 2000);
  for (const frames of [60, 120, 288]) {
    let speed = .6, travel = 0;
    for (let i = 0; i < frames; ++i) { const step = coastRotation(speed, 2000 / frames); speed = step.speed; travel += step.degrees; }
    near(speed, exact.speed); near(travel, exact.degrees);
  }
  assert.ok(coastRotation(.6, 1000).speed > .1);
  assert.ok(coastRotation(1.2, 4000).speed < .008);
  near(coastRotation(-.6, 100).degrees, -coastRotation(.6, 100).degrees);
});
