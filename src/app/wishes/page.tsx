import MainLayout from "@/components/layout/MainLayout";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  Tab,
  Tabs,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";

// Demo data
const wishes = [
  {
    id: 1,
    employee: "Maria Müller",
    date: "25.01.2026",
    shiftType: "Früh",
    priority: "Stark",
    note: "Arzttermin am Nachmittag",
    status: "offen",
  },
  {
    id: 2,
    employee: "Thomas Schmidt",
    date: "26.01.2026",
    shiftType: "Frei",
    priority: "Normal",
    note: "Familienfeier",
    status: "offen",
  },
  {
    id: 3,
    employee: "Anna Weber",
    date: "27.01.2026",
    shiftType: "Spät",
    priority: "Normal",
    note: "",
    status: "offen",
  },
  {
    id: 4,
    employee: "Michael Fischer",
    date: "28.01.2026",
    shiftType: "Nacht",
    priority: "Stark",
    note: "Bevorzuge Nachtschichten",
    status: "offen",
  },
  {
    id: 5,
    employee: "Sandra Becker",
    date: "24.01.2026",
    shiftType: "Früh",
    priority: "Normal",
    note: "",
    status: "erfüllt",
  },
  {
    id: 6,
    employee: "Klaus Wagner",
    date: "23.01.2026",
    shiftType: "Frei",
    priority: "Normal",
    note: "Behördentermin",
    status: "abgelehnt",
  },
];

export default function WishesPage() {
  return (
    <MainLayout title="Dienstwünsche">
      <Card>
        <CardContent>
          <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
            <Tabs value={0}>
              <Tab label="Offen (4)" />
              <Tab label="Erfüllt (12)" />
              <Tab label="Abgelehnt (3)" />
              <Tab label="Alle" />
            </Tabs>
          </Box>

          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 3,
            }}
          >
            <TextField
              placeholder="Suchen..."
              size="small"
              sx={{ width: 300 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
              }}
            />
            <Box sx={{ display: "flex", gap: 1 }}>
              <Chip label="Diese Woche" color="primary" />
              <Chip label="Nächste Woche" variant="outlined" />
              <Chip label="Dieser Monat" variant="outlined" />
            </Box>
          </Box>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Mitarbeiter</TableCell>
                  <TableCell>Datum</TableCell>
                  <TableCell>Wunsch</TableCell>
                  <TableCell>Priorität</TableCell>
                  <TableCell>Notiz</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Aktionen</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {wishes.map((wish) => (
                  <TableRow key={wish.id} hover>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <Avatar sx={{ bgcolor: "primary.main", width: 32, height: 32 }}>
                          {wish.employee
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </Avatar>
                        <Typography variant="body2">{wish.employee}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>{wish.date}</TableCell>
                    <TableCell>
                      <Chip
                        label={wish.shiftType}
                        size="small"
                        color={
                          wish.shiftType === "Früh"
                            ? "warning"
                            : wish.shiftType === "Spät"
                            ? "info"
                            : wish.shiftType === "Nacht"
                            ? "secondary"
                            : "default"
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={wish.priority}
                        size="small"
                        variant="outlined"
                        color={wish.priority === "Stark" ? "error" : "default"}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {wish.note || "-"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={wish.status}
                        size="small"
                        color={
                          wish.status === "offen"
                            ? "warning"
                            : wish.status === "erfüllt"
                            ? "success"
                            : "error"
                        }
                      />
                    </TableCell>
                    <TableCell align="right">
                      {wish.status === "offen" && (
                        <>
                          <IconButton size="small" color="success">
                            <CheckIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" color="error">
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </MainLayout>
  );
}
