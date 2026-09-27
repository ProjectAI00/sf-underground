## Arcade-tuned rear-wheel-drive car on Godot's VehicleBody3D. Forward is +Z.
class_name Car
extends VehicleBody3D

const ENGINE_FORCE := 5200.0
const BRAKE_FORCE := 45.0
const MAX_STEER := 0.55
const GRIP := 3.2
const DRIFT_GRIP := 1.3

var autopilot_path := PackedVector3Array()
var autopilot_speed := 15.0
var headlights: Array[SpotLight3D] = []

var _wheels: Array[VehicleWheel3D] = []
var _tail_mat: StandardMaterial3D
var _progress := 0
var _pending_reset := Transform3D()
var _has_reset := false
var _started := false


func _ready() -> void:
	mass = 1300.0
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3(0, -0.35, 0.1)
	_build_body()
	for spec in [[0.82, 1.35, true], [-0.82, 1.35, true], [0.82, -1.3, false], [-0.82, -1.3, false]]:
		_add_wheel(Vector3(spec[0], 0.0, spec[1]), spec[2])


func _physics_process(delta: float) -> void:
	var throttle := 0.0
	var brake_in := 0.0
	var steer_in := 0.0
	var handbrake := false
	if autopilot_path.size() > 1:
		var ap := _autopilot()
		throttle = ap.x
		steer_in = ap.y
		brake_in = ap.z
	else:
		throttle = Input.get_action_strength("accelerate")
		brake_in = Input.get_action_strength("brake")
		steer_in = Input.get_action_strength("steer_left") - Input.get_action_strength("steer_right")
		handbrake = Input.is_action_pressed("handbrake")

	var fwd_speed := linear_velocity.dot(global_basis.z)
	var steer_limit := lerpf(MAX_STEER, 0.18, clampf(absf(fwd_speed) / 40.0, 0.0, 1.0))
	steering = move_toward(steering, steer_in * steer_limit, delta * 2.5)

	if brake_in > 0.0 and fwd_speed < 1.0:
		engine_force = -ENGINE_FORCE * 0.5 * brake_in
		brake = 0.0
	else:
		engine_force = ENGINE_FORCE * throttle
		brake = BRAKE_FORCE * brake_in
	for w in _wheels:
		if not w.use_as_steering:
			w.wheel_friction_slip = DRIFT_GRIP if handbrake else GRIP
	if handbrake:
		brake = maxf(brake, 8.0)
	_tail_mat.emission_energy_multiplier = 4.0 if brake_in > 0.0 or handbrake else 1.2


func reset_to(t: Transform3D) -> void:
	if not is_inside_tree() or not _started:
		global_transform = t
	_pending_reset = t
	_has_reset = true
	_progress = 0


func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
	_started = true
	if _has_reset:
		_has_reset = false
		state.transform = _pending_reset
		state.linear_velocity = Vector3.ZERO
		state.angular_velocity = Vector3.ZERO


func set_headlights(on: bool) -> void:
	for l in headlights:
		l.visible = on


func follow(path: PackedVector3Array, speed: float) -> void:
	autopilot_path = path
	autopilot_speed = speed
	_progress = 0


## Pure-pursuit steering along the path. Returns (throttle, steer, brake).
func _autopilot() -> Vector3:
	var pos := global_position
	var best := _progress
	var best_d := INF
	for i in range(_progress, mini(_progress + 30, autopilot_path.size())):
		var d := pos.distance_squared_to(autopilot_path[i])
		if d < best_d:
			best_d = d
			best = i
	_progress = best
	if _progress >= autopilot_path.size() - 3:
		return Vector3(0, 0, 1)
	var look := mini(_progress + 3, autopilot_path.size() - 1)
	var local := to_local(autopilot_path[look])
	var angle := atan2(local.x, local.z)
	var speed := linear_velocity.dot(global_basis.z)
	var target := autopilot_speed * lerpf(1.0, 0.45, clampf(absf(angle) / 0.6, 0.0, 1.0))
	var throttle := clampf((target - speed) * 0.3, 0.0, 1.0)
	var brk := clampf((speed - target) * 0.1, 0.0, 1.0)
	return Vector3(throttle, clampf(angle * 1.6, -1.0, 1.0), brk)


func _build_body() -> void:
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1.8, 0.7, 4.3)
	shape.shape = box
	shape.position = Vector3(0, 0.45, 0)
	add_child(shape)

	var paint := StandardMaterial3D.new()
	paint.albedo_color = Color(0.85, 0.12, 0.16)
	paint.metallic = 0.5
	paint.roughness = 0.28
	var glass := StandardMaterial3D.new()
	glass.albedo_color = Color(0.06, 0.08, 0.1)
	glass.roughness = 0.08
	glass.metallic = 0.6
	_part(Vector3(1.85, 0.55, 4.4), Vector3(0, 0.45, 0), paint)
	_part(Vector3(1.6, 0.5, 2.1), Vector3(0, 0.95, -0.25), glass)
	_part(Vector3(1.5, 0.08, 1.9), Vector3(0, 1.22, -0.25), paint)

	var head := StandardMaterial3D.new()
	head.emission_enabled = true
	head.emission = Color(1, 0.95, 0.8)
	head.emission_energy_multiplier = 3.0
	_tail_mat = StandardMaterial3D.new()
	_tail_mat.albedo_color = Color(0.4, 0, 0)
	_tail_mat.emission_enabled = true
	_tail_mat.emission = Color(1, 0.05, 0.05)
	for x in [-0.62, 0.62]:
		_part(Vector3(0.4, 0.14, 0.05), Vector3(x, 0.55, 2.2), head)
		_part(Vector3(0.45, 0.14, 0.05), Vector3(x, 0.6, -2.2), _tail_mat)
		var l := SpotLight3D.new()
		l.position = Vector3(x, 0.6, 2.25)
		l.rotation = Vector3(deg_to_rad(-8), PI, 0)
		l.spot_range = 45.0
		l.spot_angle = 32.0
		l.light_energy = 6.0
		l.light_color = Color(1, 0.93, 0.8)
		l.visible = false
		add_child(l)
		headlights.append(l)


func _part(size: Vector3, pos: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.material_override = mat
	add_child(mi)


func _add_wheel(pos: Vector3, front: bool) -> void:
	var w := VehicleWheel3D.new()
	w.position = pos + Vector3(0, 0.35, 0)
	w.use_as_steering = front
	w.use_as_traction = not front
	w.wheel_radius = 0.36
	w.wheel_rest_length = 0.22
	w.suspension_travel = 0.25
	w.suspension_stiffness = 48.0
	w.suspension_max_force = 12000.0
	w.damping_compression = 2.8
	w.damping_relaxation = 3.6
	w.wheel_friction_slip = GRIP
	w.wheel_roll_influence = 0.15
	add_child(w)
	_wheels.append(w)
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.36
	cm.bottom_radius = 0.36
	cm.height = 0.26
	mi.mesh = cm
	mi.rotation = Vector3(0, 0, PI / 2)
	var rubber := StandardMaterial3D.new()
	rubber.albedo_color = Color(0.07, 0.07, 0.08)
	rubber.roughness = 0.9
	mi.material_override = rubber
	w.add_child(mi)
