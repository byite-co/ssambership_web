FROM python@sha256:bf44cdfcb76cd3b41e879bc058fc37ec5872002ccfde7fcb765e218cde0cd79c AS python
FROM postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336
COPY --from=python /usr/local/ /usr/local/
RUN /sbin/ldconfig
# Same immutable PostgreSQL/Python bases as the successful v3 observer.
RUN /usr/local/bin/python3 -I -c 'import ctypes,subprocess; assert ctypes.CDLL("/usr/lib/x86_64-linux-gnu/libpq.so.5").PQlibVersion()==180006; assert subprocess.check_output(["/usr/bin/psql","--version"],text=True).startswith("psql (PostgreSQL) 18.6 "); assert subprocess.check_output(["dpkg-query","-W","-f=${Version}","libpq5"],text=True)=="18.6-1.pgdg13+2"'
WORKDIR /opt/executor
COPY --chmod=0555 . /opt/executor/
COPY --from=cli-tools --chmod=0555 /supabase /supabase-go /tools/
ENTRYPOINT ["/usr/local/bin/python3", "-I", "-B", "/opt/executor/run.py"]
