import sys

from backend.services import onnx_runtime_loader as loader
from backend.services import onnx_runtime_provision as prov


def test_bundled_when_onnxruntime_importable(monkeypatch):
    monkeypatch.setattr(loader.importlib.util, "find_spec", lambda name: object())
    assert loader.ensure_onnxruntime_importable() == "bundled"


def test_missing_when_no_runtime(monkeypatch, tmp_path):
    monkeypatch.setattr(loader.importlib.util, "find_spec", lambda name: None)
    monkeypatch.setattr(loader, "select_runtime_host_class", lambda: "cpu")
    monkeypatch.setattr(prov, "_provisioner", prov.RuntimeProvisioner(runtime_dir=tmp_path))
    assert loader.ensure_onnxruntime_importable() == "missing"


def test_loaded_when_runtime_present(monkeypatch, tmp_path):
    monkeypatch.setattr(loader.importlib.util, "find_spec", lambda name: None)
    monkeypatch.setattr(loader, "select_runtime_host_class", lambda: "cpu")
    monkeypatch.setattr(prov, "_provisioner", prov.RuntimeProvisioner(runtime_dir=tmp_path))
    (tmp_path / "cpu" / "onnxruntime" / "capi").mkdir(parents=True)
    (tmp_path / "cpu" / "onnxruntime" / "__init__.py").write_text("# stub")

    result = loader.ensure_onnxruntime_importable()
    assert result == "loaded"
    assert str(tmp_path / "cpu") in sys.path
    sys.path.remove(str(tmp_path / "cpu"))  # cleanup
