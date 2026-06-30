package expo.modules.volumekeypaging

import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

object VolumeKeyPagingState {
  @Volatile var enabled = false
  @Volatile var emitter: ((String) -> Unit)? = null
}

class VolumeKeyPagingModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VolumeKeyPaging")
    Events("VolumeKeyPaging")

    OnCreate {
      val weak = WeakReference(this@VolumeKeyPagingModule)
      VolumeKeyPagingState.emitter = { direction ->
        weak.get()?.sendEvent("VolumeKeyPaging", bundleOf("direction" to direction))
      }
    }
    OnDestroy {
      VolumeKeyPagingState.enabled = false
      VolumeKeyPagingState.emitter = null
    }

    Function("setEnabled") { value: Boolean ->
      VolumeKeyPagingState.enabled = value
    }
  }
}
