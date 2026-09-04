#ifndef VOXWEAVE_WIN32_COMPAT_H
#define VOXWEAVE_WIN32_COMPAT_H

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <io.h>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>

#ifndef MAP_FAILED
#define MAP_FAILED ((void *)-1)
#endif
#define PROT_READ 1
#define MAP_PRIVATE 2
#define POSIX_FADV_DONTNEED 4
#define POSIX_MADV_WILLNEED 3
#define POSIX_MADV_DONTNEED 4

static inline void *voxweave_mmap(void *addr, size_t length, int prot,
                                  int flags, int fd, int64_t offset) {
    (void)addr; (void)prot; (void)flags;
    HANDLE file = (HANDLE)_get_osfhandle(fd);
    if (file == INVALID_HANDLE_VALUE) { errno = EBADF; return MAP_FAILED; }
    HANDLE mapping = CreateFileMappingW(file, NULL, PAGE_READONLY, 0, 0, NULL);
    if (!mapping) { errno = EIO; return MAP_FAILED; }
    void *view = MapViewOfFile(mapping, FILE_MAP_READ,
                               (DWORD)((uint64_t)offset >> 32),
                               (DWORD)((uint64_t)offset & 0xffffffffu), length);
    CloseHandle(mapping);
    if (!view) { errno = EIO; return MAP_FAILED; }
    return view;
}

static inline int voxweave_munmap(void *addr, size_t length) {
    (void)length;
    return UnmapViewOfFile(addr) ? 0 : -1;
}

static inline intptr_t voxweave_pread(int fd, void *buf, size_t count, int64_t offset) {
    HANDLE file = (HANDLE)_get_osfhandle(fd);
    if (file == INVALID_HANDLE_VALUE) { errno = EBADF; return -1; }
    OVERLAPPED ov = {0};
    ov.Offset = (DWORD)((uint64_t)offset & 0xffffffffu);
    ov.OffsetHigh = (DWORD)((uint64_t)offset >> 32);
    DWORD got = 0;
    DWORD ask = count > UINT32_MAX ? UINT32_MAX : (DWORD)count;
    if (!ReadFile(file, buf, ask, &got, &ov)) { errno = EIO; return -1; }
    return (intptr_t)got;
}

static inline int voxweave_posix_fadvise(int fd, int64_t off, int64_t len, int advice) {
    (void)fd; (void)off; (void)len; (void)advice;
    return 0;
}

static inline int voxweave_posix_madvise(void *addr, size_t len, int advice) {
    (void)addr; (void)len; (void)advice;
    return 0;
}

#define mmap voxweave_mmap
#define munmap voxweave_munmap
#define pread voxweave_pread
#define posix_fadvise voxweave_posix_fadvise
#define posix_madvise voxweave_posix_madvise
#define setenv(name, value, overwrite) ((void)(overwrite), _putenv_s((name), (value)))
#endif

#endif
