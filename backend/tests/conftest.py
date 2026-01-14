import sys
from pathlib import Path

# Add project root to Python path for test discovery
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
