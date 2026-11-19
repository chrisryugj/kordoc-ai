use std::{io, ptr};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject, INFINITE},
};

/// Explorer는 선택한 파일마다 앱을 시작한다. Tauri의 Windows 단일 인스턴스 플러그인은
/// 첫 프로세스가 자체 뮤텍스를 만든 뒤 메시지 수신 창을 만들기 전에 둘째가 들어오면
/// 둘째도 앱을 켠다. 별도 잠금으로 플러그인의 초기화 구간을 한 프로세스씩 통과시킨다.
pub(crate) fn lock(app_id: &str) -> io::Result<StartupLock> {
    StartupLock::acquire(&format!(r"Local\{app_id}-startup"), INFINITE)
}

pub(crate) struct StartupLock(HANDLE);

impl StartupLock {
    fn acquire(name: &str, wait_ms: u32) -> io::Result<Self> {
        let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let handle = unsafe { CreateMutexW(ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let error = match unsafe { WaitForSingleObject(handle, wait_ms) } {
            WAIT_OBJECT_0 | WAIT_ABANDONED => return Ok(Self(handle)),
            WAIT_TIMEOUT => io::Error::from(io::ErrorKind::TimedOut),
            _ => io::Error::last_os_error(),
        };
        unsafe { CloseHandle(handle) };
        Err(error)
    }
}

impl Drop for StartupLock {
    fn drop(&mut self) {
        // Windows 뮤텍스는 획득한 스레드에서 놓고, 마지막 핸들이 닫히면 사라진다.
        unsafe {
            ReleaseMutex(self.0);
            CloseHandle(self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_launch_waits_for_the_first_startup() {
        let name = format!(r"Local\com.kordoc-ai.test-startup-{}", std::process::id());
        let first = StartupLock::acquire(&name, 0).expect("첫 앱의 잠금");
        std::thread::scope(|scope| {
            let waiting = scope.spawn(|| StartupLock::acquire(&name, 0).err().map(|e| e.kind()));
            assert_eq!(waiting.join().unwrap(), Some(io::ErrorKind::TimedOut));
            drop(first);
            let next = scope.spawn(|| StartupLock::acquire(&name, 0).map(drop));
            next.join().unwrap().expect("첫 앱이 잠금을 놓으면 다음 앱이 지나간다");
        });
    }
}
