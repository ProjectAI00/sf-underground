## Follow camera with three modes: retro top-down, chase, and a cinematic orbit of the tile.
class_name CameraRig
extends Camera3D

enum Mode { TOP_DOWN, CHASE, ORBIT }

var mode := Mode.TOP_DOWN
var target: Node3D
var orbit_center := Vector3.ZERO
var orbit_radius := 380.0
var orbit_height := 260.0
## Top-down camera sits above the tallest towers with a narrow lens; zoom changes the ground span.
var top_down_altitude := 420.0
var top_down_span := 80.0

var _orbit_t := 0.0


func _ready() -> void:
	far = 5000.0


func cycle() -> void:
	mode = ((mode + 1) % Mode.size()) as Mode


func snap() -> void:
	_update(1.0, true)


func _process(delta: float) -> void:
	_update(delta, false)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			top_down_span = maxf(25.0, top_down_span * 0.9)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			top_down_span = minf(600.0, top_down_span * 1.1)


func _update(delta: float, instant: bool) -> void:
	var k := 1.0 if instant else 1.0 - exp(-delta * 5.0)
	match mode:
		Mode.ORBIT:
			fov = 45.0
			_orbit_t += delta * 0.06
			var p := orbit_center + Vector3(cos(_orbit_t) * orbit_radius, orbit_height, sin(_orbit_t) * orbit_radius)
			global_position = p
			look_at(orbit_center, Vector3.UP)
		Mode.TOP_DOWN:
			if target == null:
				return
			fov = rad_to_deg(2.0 * atan(top_down_span * 0.5 / top_down_altitude))
			var vel := (target as RigidBody3D).linear_velocity if target is RigidBody3D else Vector3.ZERO
			var focus := target.global_position + Vector3(vel.x, 0, vel.z) * 0.6
			var want := focus + Vector3(0, top_down_altitude, top_down_altitude * 0.3)
			global_position = global_position.lerp(want, k)
			look_at(global_position + Vector3(0, -1, -0.3), Vector3.FORWARD)
		Mode.CHASE:
			if target == null:
				return
			fov = 60.0
			var t := target.global_transform
			var want := t * Vector3(0, 3.0, -8.5)
			global_position = global_position.lerp(want, k)
			look_at(t * Vector3(0, 1.2, 4.0), Vector3.UP)
