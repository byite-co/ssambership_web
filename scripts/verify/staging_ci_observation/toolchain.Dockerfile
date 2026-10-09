FROM python@sha256:bf44cdfcb76cd3b41e879bc058fc37ec5872002ccfde7fcb765e218cde0cd79c AS python
FROM postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336

# Both immutable images are Debian trixie, linux/amd64. No apt/pip downloads.
COPY --from=python /usr/local/ /usr/local/
RUN /sbin/ldconfig
WORKDIR /observer
COPY --chmod=0444 observe.py snapshot.sql toolchain.json /observer/
RUN /usr/local/bin/python3 -I -c 'import ctypes,json,subprocess; d=json.load(open("toolchain.json")); p=subprocess.check_output([d["psql_path"],"--version"],text=True); v=ctypes.CDLL(d["libpq_path"]).PQlibVersion(); assert p.startswith("psql (PostgreSQL) 18.6 ") and v==180006; assert subprocess.check_output(["dpkg-query","-W","-f=${Version}","libpq5"],text=True)=="18.6-1.pgdg13+2"; assert subprocess.check_output(["dpkg-query","-W","-f=${Version}","postgresql-client-18"],text=True)=="18.6-1.pgdg13+2"; print(p.strip(), "libpq",v)'
ENTRYPOINT ["/usr/local/bin/python3", "-I", "/observer/observe.py"]
