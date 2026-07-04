from unittest.mock import patch

from backend.services import onnx_runtime_manifest as m


def test_manifest_has_cpu_and_directml_pins():
    cpu = m.get_runtime_asset("cpu")
    dml = m.get_runtime_asset("directml")
    assert cpu.package == "onnxruntime" and cpu.sha256 and cpu.size_bytes > 0
    assert dml.package == "onnxruntime-directml" and dml.sha256 and dml.size_bytes > 0
    assert m.get_runtime_asset("bogus") is None


def test_host_class_directml_for_nvidia_else_cpu():
    with patch.object(m, "detect_hardware", return_value={"gpu": "NVIDIA GeForce RTX 3090"}):
        assert m.select_runtime_host_class() == "directml"
    with patch.object(m, "detect_hardware", return_value={"gpu": None}):
        assert m.select_runtime_host_class() == "cpu"
    with patch.object(m, "detect_hardware", return_value={"gpu": "AMD Radeon"}):
        assert m.select_runtime_host_class() == "cpu"  # v1: only NVIDIA -> directml
