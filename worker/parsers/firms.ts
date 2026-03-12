humidity_pct: null,
            satellite_only: true,
            latitude: lat,
            longitude: lon,
            acq_datetime_utc: acqDatetime,
          },
          geometry: pointGeometry(lon, lat),
        });
      } catch (err) {
        dropped += 1;
        errors.push(`FIRMS row ${i} dropped: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`FIRMS payload rejected: ${(err as Error).message}`);
  }

  return { items, dropped, errors };
}
