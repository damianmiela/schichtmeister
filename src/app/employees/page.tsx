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
  Button,
  TextField,
  InputAdornment,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";

// Demo data
const employees = [
  {
    id: 1,
    name: "Maria Müller",
    role: "Pflegefachkraft",
    contract: "Vollzeit",
    hours: "40h/Woche",
    status: "aktiv",
    qualifications: ["Examiniert", "Wundversorgung"],
  },
  {
    id: 2,
    name: "Thomas Schmidt",
    role: "Pflegefachkraft",
    contract: "Teilzeit",
    hours: "30h/Woche",
    status: "aktiv",
    qualifications: ["Examiniert"],
  },
  {
    id: 3,
    name: "Anna Weber",
    role: "Pflegehilfskraft",
    contract: "Vollzeit",
    hours: "40h/Woche",
    status: "aktiv",
    qualifications: ["Basiskurs"],
  },
  {
    id: 4,
    name: "Michael Fischer",
    role: "Pflegefachkraft",
    contract: "Mini-Job",
    hours: "max. 43h/Monat",
    status: "aktiv",
    qualifications: ["Examiniert", "Palliativ"],
  },
  {
    id: 5,
    name: "Sandra Becker",
    role: "Pflegefachkraft",
    contract: "Teilzeit",
    hours: "20h/Woche",
    status: "aktiv",
    qualifications: ["Examiniert"],
  },
  {
    id: 6,
    name: "Klaus Wagner",
    role: "Pflegehilfskraft",
    contract: "Vollzeit",
    hours: "40h/Woche",
    status: "aktiv",
    qualifications: ["Basiskurs", "Betreuung"],
  },
  {
    id: 7,
    name: "Julia Hoffmann",
    role: "Pflegefachkraft",
    contract: "Vollzeit",
    hours: "40h/Woche",
    status: "Urlaub",
    qualifications: ["Examiniert", "Praxisanleitung"],
  },
  {
    id: 8,
    name: "Peter Schulz",
    role: "Pflegefachkraft",
    contract: "Teilzeit",
    hours: "25h/Woche",
    status: "aktiv",
    qualifications: ["Examiniert"],
  },
];

export default function EmployeesPage() {
  return (
    <MainLayout title="Mitarbeiter">
      <Card>
        <CardContent>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 3,
            }}
          >
            <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
              <TextField
                placeholder="Mitarbeiter suchen..."
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
              <Chip label="Alle" color="primary" />
              <Chip label="Vollzeit" variant="outlined" />
              <Chip label="Teilzeit" variant="outlined" />
              <Chip label="Mini-Job" variant="outlined" />
            </Box>
            <Button variant="contained" startIcon={<AddIcon />}>
              Mitarbeiter hinzufügen
            </Button>
          </Box>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Mitarbeiter</TableCell>
                  <TableCell>Position</TableCell>
                  <TableCell>Vertrag</TableCell>
                  <TableCell>Qualifikationen</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Aktionen</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {employees.map((employee) => (
                  <TableRow key={employee.id} hover>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <Avatar sx={{ bgcolor: "primary.main" }}>
                          {employee.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </Avatar>
                        <Box>
                          <Typography variant="body2" fontWeight={500}>
                            {employee.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {employee.hours}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>{employee.role}</TableCell>
                    <TableCell>
                      <Chip
                        label={employee.contract}
                        size="small"
                        variant="outlined"
                        color={
                          employee.contract === "Vollzeit"
                            ? "success"
                            : employee.contract === "Teilzeit"
                            ? "info"
                            : "warning"
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                        {employee.qualifications.map((qual) => (
                          <Chip
                            key={qual}
                            label={qual}
                            size="small"
                            sx={{ fontSize: 11 }}
                          />
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={employee.status}
                        size="small"
                        color={employee.status === "aktiv" ? "success" : "warning"}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small">
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mt: 2,
              pt: 2,
              borderTop: 1,
              borderColor: "divider",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Zeige 1-8 von 42 Mitarbeitern
            </Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button size="small" disabled>
                Zurück
              </Button>
              <Button size="small">Weiter</Button>
            </Box>
          </Box>
        </CardContent>
      </Card>
    </MainLayout>
  );
}
