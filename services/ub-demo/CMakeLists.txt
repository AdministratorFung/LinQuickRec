cmake_minimum_required(VERSION 3.14)
project(ub_demo)

option(ENABLE_URMA "Enable UBSocket/URMA transport" OFF)

find_package(Protobuf REQUIRED)
find_package(Threads REQUIRED)

set(BRPC_INCLUDE_DIR /usr/local/include /usr/local/include/absl/strings/)
set(BRPC_LIBRARIES brpc gflags ssl crypto z pthread leveldb)

if(ENABLE_URMA)
    add_definitions(-DBRPC_WITH_URMA)
    list(APPEND BRPC_LIBRARIES ubsocket)
endif()

link_directories(/usr/local/lib64)

set(ABSL_LIBS
    absl_log_internal_nullguard
    absl_log_internal_check_op
    absl_log_internal_message
    absl_raw_logging_internal
    absl_strings
    absl_base
    absl_time
    absl_synchronization
    absl_status
    absl_hash
    absl_spinlock_wait
)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# Proto compilation
set(PROTO_FILE ${CMAKE_CURRENT_SOURCE_DIR}/proto/echo.proto)
set(PROTO_SRC ${CMAKE_CURRENT_BINARY_DIR}/echo.pb.cc)
add_custom_command(
    OUTPUT ${PROTO_SRC} ${CMAKE_CURRENT_BINARY_DIR}/echo.pb.h
    COMMAND ${Protobuf_PROTOC_EXECUTABLE}
    ARGS --proto_path ${CMAKE_CURRENT_SOURCE_DIR}/proto
         --cpp_out ${CMAKE_CURRENT_BINARY_DIR}
         echo.proto
    DEPENDS ${PROTO_FILE}
)

# --- Server ---
add_executable(ub_demo_server
    server/main.cpp
    ${PROTO_SRC}
)
target_include_directories(ub_demo_server PRIVATE
    ${BRPC_INCLUDE_DIR}
    ${CMAKE_CURRENT_BINARY_DIR}
)
target_link_libraries(ub_demo_server PRIVATE
    ${BRPC_LIBRARIES}
    ${Protobuf_LIBRARIES}
    ${ABSL_LIBS}
    Threads::Threads
)
set_target_properties(ub_demo_server PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin
)

# --- Client ---
add_executable(ub_demo_client
    client/main.cpp
    ${PROTO_SRC}
)
target_include_directories(ub_demo_client PRIVATE
    ${BRPC_INCLUDE_DIR}
    ${CMAKE_CURRENT_BINARY_DIR}
)
target_link_libraries(ub_demo_client PRIVATE
    ${BRPC_LIBRARIES}
    ${Protobuf_LIBRARIES}
    ${ABSL_LIBS}
    Threads::Threads
)
set_target_properties(ub_demo_client PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin
)
